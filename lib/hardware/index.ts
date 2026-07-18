export type {
  HardwareCapabilityId,
  HardwareArgumentLimit,
  HardwareCapabilityLimit,
  HardwareCommand,
  HardwareExecuteResult,
  HardwareExecutionEvidence,
  HardwareSignalState,
  InterlockOverride,
  SensorInterlockRequirement,
  SensorReading,
  TransportFrame,
  TransportResponse
} from './types';
// NOTE (audit 1.1): `./internal/actuation` is deliberately NOT re-exported.
// Only the ActuationTicket TYPE is public (needed to implement
// RealDeviceTransport); the ticket VALUE stays gate-private.
export type { ActuationTicket } from './internal/actuation';
export { TransportFrameRejectedError, TransportOfflineError } from './RealDeviceTransport';
export type { RealDeviceTransport } from './RealDeviceTransport';
export { SerialEsp32Transport, createNodeSerialPort } from './SerialEsp32Transport';
export type { SerialPortLike, SerialEsp32TransportOptions } from './SerialEsp32Transport';
export { Esp32DeviceAdapter, ESP32_SERVO_RIG_CAPABILITIES } from './Esp32DeviceAdapter';
export { HardwareExecutionGate } from './HardwareExecutionGate';
export { DistanceSensorPollingService } from './SensorPollingService';
export type {
  DistanceSensorPollingOptions,
  DistanceSensorReader,
  SensorEvidenceSnapshot,
  SensorEvidenceSubscriber,
  SensorPollingState
} from './SensorPollingService';
export { HardwareActionSequenceRunner } from './HardwareActionSequenceRunner';
export type {
  HardwareActionSequenceOptions,
  HardwareActionSequenceResult,
  HardwareActionSequenceStatus,
  HardwareActionSequenceStepResult,
  SensorEvidencePoller
} from './HardwareActionSequenceRunner';
export { adviceForFailure, interpretProbe, EXPECTED_FIRMWARE, EXPECTED_FIRMWARE_VERSION, EXPECTED_FIRMWARE_VERSIONS } from './SetupAdvisor';
export type { FirmwareIdentity, SetupAdvice, AdviceSeverity } from './SetupAdvisor';
export {
  MedianFilter,
  DistanceInterlock,
  DeviceClockBaseline,
  StuckValueDetector,
  buildConservativeMedianReading
} from './SensorConditioning';
export type { DistanceInterlockOptions, DistanceInterlockState, StuckValueDetectorOptions } from './SensorConditioning';
export type { HardwareGateOutcome, HardwareGateRequest, HardwareGateStatus } from './HardwareExecutionGate';
export {
  REAL_SERVO_TEACH_DEVICE_META,
  REAL_TEACH_BUILTIN_INTENT_IDS,
  buildTeachManifest,
  hardwareCommandsFromTeachTaskDsl,
  waypointAfterJog
} from './TeachMode';
export type { TeachActionManifest, TeachExecutionEvidence } from './TeachMode';
export { visibleRealHardwareTelemetry } from './RealHardwareTelemetry';
export { parseRealNaturalCommand, REAL_COMMAND_MAX_STEPS } from './RealCommandParser';
export type { RealCommandParseResult, RealCommandRejectReason } from './RealCommandParser';
export {
  extractServoAngleTrack,
  SERVO_TWIN_PROFILE_ID,
  SERVO_TWIN_COMMAND,
  SERVO_ANGLE_MIN_DEG,
  SERVO_ANGLE_MAX_DEG,
  BRIDGE_MIN_STEPS,
  BRIDGE_MAX_STEPS
} from './ServoTwinAngleTrack';
export type { BridgeExtractResult, BridgeRejectReason, BridgeSimulationInput } from './ServoTwinAngleTrack';
export { simulateServoTrack, SERVO_TWIN_DEVICE_META } from './ServoTwinSimulation';
export type { ServoTwinResult, ServoTwinCompleted, ServoTwinBlocked, ServoTwinOptions } from './ServoTwinSimulation';
export { prepareRealProposalFromIntent, extractManifestAngles } from './ReferenceServoPreflight';
export type { RealProposalResult, RealProposalReady, RealProposalRejected, BridgeStage, PrepareProposalOptions } from './ReferenceServoPreflight';
export type { ManifestAngleResult } from './ReferenceServoPreflight';
export { formatReferenceServoPreflight } from './ReferenceServoPreflightView';
export type { ReferenceServoPreflightView } from './ReferenceServoPreflightView';
export { buildReferenceServoPreflightDecision, recordReferenceServoPreflightDecision } from './ReferenceServoPreflightAudit';
export type { ReferenceServoPreflightDecision } from './ReferenceServoPreflightAudit';
export { parseServoIntent, SERVO_INTENT_MAX_STEPS } from './ServoIntentParser';
export type { ServoIntentResult } from './ServoIntentParser';
