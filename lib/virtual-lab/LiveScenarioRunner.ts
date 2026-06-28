import { createAdapterCommand } from '@/lib/adapter/AdapterCommandCompiler';
import type { AdapterCommand } from '@/lib/adapter/AdapterCommand';
import { buildRobotArmActionPlan } from '@/lib/action-runtime/buildRobotArmActionPlan';
import { DeviceActionRuntime } from '@/lib/action-runtime/DeviceActionRuntime';
import { summarizeActionPlan } from '@/lib/action-runtime/ActionPlan';
import type { OpenRealityRuntimeResult } from '@/lib/open-reality-runtime/types';
import { buildExecutionLabReport } from '@/lib/reporting/buildLabReport';
import type { ActionPlan } from '@/lib/action-runtime/ActionPlan';
import type { ActionFrame } from '@/lib/action-runtime/ActionState';
import { compilePromptToTaskDSL } from '@/lib/compiler/mockTaskCompiler';
import { runSafetyRuntime } from '@/lib/safety/SafetyRuntime';
import type { DeviceProfile } from '@/types/deviceMeta';
import type { SafetyReport } from '@/types/safety';
import type { TaskDSL } from '@/types/taskDsl';
import type { DeviceScenario } from './DeviceScenario';
import type { ExecutionTimelineEvent, LabReport, TimelineStateSnapshot } from './LabReport';
import { VirtualDeviceInstance } from './VirtualDeviceInstance';

export type LiveScenarioEvent =
  | { kind: 'compile'; message: string; timeline_ms: number }
  | { kind: 'safety'; message: string; safety_report: SafetyReport; timeline_ms: number }
  | { kind: 'command_start'; message: string; command: AdapterCommand; timeline_ms: number }
  | { kind: 'frame'; message: string; command: AdapterCommand; frame: ActionFrame; frame_index: number; timeline_ms: number }
  | { kind: 'command_complete'; message: string; command: AdapterCommand; snapshot: TimelineStateSnapshot; timeline_ms: number }
  | { kind: 'blocked'; message: string; command?: AdapterCommand; snapshot: TimelineStateSnapshot; timeline_ms: number }
  | { kind: 'report'; message: string; report: LabReport; timeline_ms: number };

function timeline(stage: ExecutionTimelineEvent['stage'], message: string, index: number): ExecutionTimelineEvent {
  return {
    id: `evt-${index}`,
    timestamp_ms: index * 120,
    stage,
    message
  };
}

function diffKeys(before: Record<string, unknown>, after: Record<string, unknown>) {
  return Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

function snapshot({
  stepIndex,
  stepId,
  commandId,
  stage,
  safetyReport,
  before,
  after,
  message,
  actionFrame
}: {
  stepIndex: number;
  stepId: string;
  commandId?: string;
  stage: TimelineStateSnapshot['stage'];
  safetyReport: SafetyReport;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  message: string;
  actionFrame?: ActionFrame;
}): TimelineStateSnapshot {
  return {
    step_index: stepIndex,
    step_id: stepId,
    command_id: commandId,
    stage,
    safety_status: safetyReport.status,
    safety_report: safetyReport,
    device_state: after,
    action_frame: actionFrame,
    changed_keys: diffKeys(before, after),
    message,
    timestamp_ms: stepIndex * 120
  };
}

function planForCommand(
  actionRuntime: DeviceActionRuntime,
  command: AdapterCommand,
  profile: DeviceProfile,
  currentState: Record<string, unknown>
): ActionPlan {
  if (profile.deviceMeta.device_type === 'robot_arm' && command.action === 'move_to_pose') {
    return buildRobotArmActionPlan({
      command,
      deviceMeta: profile.deviceMeta,
      geometry: profile.geometry,
      stateBefore: currentState
    });
  }
  return actionRuntime.createActionPlan(command, profile.deviceMeta, profile.geometry, currentState);
}

export class LiveScenarioRunner {
  async *run(
    profile: DeviceProfile,
    scenario: DeviceScenario,
    promptOverride?: string,
    taskDslOverride?: TaskDSL,
    runtimeResult?: OpenRealityRuntimeResult | null,
    initialStateOverride?: Record<string, unknown> | null
  ): AsyncGenerator<LiveScenarioEvent> {
    const prompt = promptOverride?.trim() || scenario.prompt;
    const initialState = initialStateOverride ?? scenario.initial_state;
    const instance = new VirtualDeviceInstance(`${profile.id}-${Date.now()}`, profile.deviceMeta, profile.geometry, initialState);
    const deviceStateBefore = instance.getState();
    const actionRuntime = new DeviceActionRuntime();
    const taskDsl = taskDslOverride ?? compilePromptToTaskDSL(prompt, profile.deviceMeta.device_type);
    const safetyReport = runSafetyRuntime(profile.deviceMeta, taskDsl);
    const adapterCommands = taskDsl.steps.map((step) => createAdapterCommand(profile.deviceMeta, step));
    const actionPlans: ActionPlan[] = [];
    const stateSnapshots: TimelineStateSnapshot[] = [
      snapshot({
        stepIndex: 0,
        stepId: 'initial',
        stage: 'initial',
        safetyReport,
        before: deviceStateBefore,
        after: deviceStateBefore,
        message: 'Initial device state captured.'
      })
    ];
    const events: ExecutionTimelineEvent[] = [
      timeline('compile', `Prompt compiled to ${scenario.expected_task_type}.`, 0),
      timeline('safety', `Safety Runtime returned ${safetyReport.status}.`, 1)
    ];

    yield { kind: 'compile', message: events[0].message, timeline_ms: 0 };
    yield { kind: 'safety', message: events[1].message, safety_report: safetyReport, timeline_ms: 120 };

    let result: LabReport['result'] = 'pass';
    let cursor = 240;

    if (safetyReport.status === 'blocked') {
      result = 'blocked';
      const command = adapterCommands[0];
      if (command) {
        actionPlans.push(actionRuntime.createBlockedActionPlan(
          command,
          profile.deviceMeta,
          deviceStateBefore,
          safetyReport.blocked_reasons[0] ?? 'Safety Runtime blocked the task before adapter execution.'
        ));
      }
      const blockedSnapshot = snapshot({
        stepIndex: 1,
        stepId: command?.source_step_id ?? 'blocked',
        commandId: command?.id,
        stage: 'blocked',
        safetyReport,
        before: deviceStateBefore,
        after: deviceStateBefore,
        message: 'Blocked before adapter execution. Device state preserved.'
      });
      stateSnapshots.push(blockedSnapshot);
      events.push(timeline('adapter', 'Adapter commands were intercepted before execution.', 2));
      yield {
        kind: 'blocked',
        message: safetyReport.blocked_reasons[0] ?? 'Blocked before adapter dispatch.',
        command,
        snapshot: blockedSnapshot,
        timeline_ms: cursor
      };
    } else {
      for (let index = 0; index < adapterCommands.length; index += 1) {
        const command = adapterCommands[index];
        const before = instance.getState();
        const actionPlan = planForCommand(actionRuntime, command, profile, before);
        actionPlans.push(actionPlan);
        yield {
          kind: 'command_start',
          message: `Execute command: ${command.action}${command.target ? ` target=${command.target}` : ''}`,
          command,
          timeline_ms: cursor
        };

        if (actionPlan.validation.blocked || command.allowed === false) {
          result = 'blocked';
          const blockedSnapshot = snapshot({
            stepIndex: index + 1,
            stepId: command.source_step_id,
            commandId: command.id,
            stage: 'blocked',
            safetyReport,
            before,
            after: before,
            message: actionPlan.validation.reason ?? command.blocked_reason ?? 'Blocked before adapter dispatch.'
          });
          stateSnapshots.push(blockedSnapshot);
          events.push(timeline('adapter', `${command.id}: ${blockedSnapshot.message}`, index + 2));
          yield {
            kind: 'blocked',
            message: blockedSnapshot.message,
            command,
            snapshot: blockedSnapshot,
            timeline_ms: cursor
          };
          break;
        }

        for (let frameIndex = 0; frameIndex < actionPlan.frames.length; frameIndex += 1) {
          const frame = actionPlan.frames[frameIndex];
          instance.patchState(frame.device_state);
          yield {
            kind: 'frame',
            message: `${command.id}: ${command.action} progress=${Math.round(frame.progress * 100)}%`,
            command,
            frame,
            frame_index: frameIndex,
            timeline_ms: cursor + frame.time_ms
          };
        }

        const after = actionRuntime.executeActionPlan(actionPlan);
        instance.patchState(after);
        const commandSnapshot = snapshot({
          stepIndex: index + 1,
          stepId: command.source_step_id,
          commandId: command.id,
          stage: 'device',
          safetyReport,
          before,
          after,
          message: `${command.action} applied through ${actionPlan.action_plan_id}. ActionPlan generated ${actionPlan.frames.length} frames.`,
          actionFrame: actionPlan.frames[actionPlan.frames.length - 1]
        });
        stateSnapshots.push(commandSnapshot);
        events.push(timeline('adapter', `${command.id}: ${commandSnapshot.message}`, index + 2));
        yield {
          kind: 'command_complete',
          message: commandSnapshot.message,
          command,
          snapshot: commandSnapshot,
          timeline_ms: cursor + actionPlan.duration_ms
        };
        cursor += actionPlan.duration_ms;
      }
      events.push(timeline('device', 'Virtual device state updated by live ActionFrames.', adapterCommands.length + 2));
    }

    const deviceStateAfter = result === 'blocked' ? deviceStateBefore : instance.getState();
    const report: LabReport = buildExecutionLabReport({
      profile,
      scenarioId: scenario.id,
      prompt,
      taskDsl,
      safetyReport,
      adapterCommands,
      actionPlans: actionPlans.map(summarizeActionPlan),
      deviceStateBefore,
      deviceStateAfter,
      executionTimeline: [...events, timeline('report', `Lab run finished with result=${result}.`, events.length + 1)],
      stateSnapshots,
      result,
      runtimeResult
    });

    yield {
      kind: 'report',
      message: `Lab run finished with result=${result}.`,
      report,
      timeline_ms: cursor + 120
    };
  }
}
