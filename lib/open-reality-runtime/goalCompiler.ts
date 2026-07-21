import type { GoalCompileResult, GoalType, OpenRealityRuntimeInput } from './types';

function normalizePrompt(prompt: string) {
  return prompt
    .trim()
    .toLowerCase()
    .replace(/[.,!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}

function detectObjectRef(normalized: string) {
  if (includesAny(normalized, ['red cube', 'red block', '红方块', '红色方块'])) return 'red_cube';
  if (includesAny(normalized, ['blue cube', 'blue block', '蓝方块', '蓝色方块'])) return 'blue_cube';
  if (includesAny(normalized, ['cube', 'block', '方块'])) return 'cube';
  return undefined;
}

function detectTargetZone(normalized: string) {
  if (includesAny(normalized, ['back safe zone', 'back area', 'rear', '后侧安全区', '后侧', '后方'])) return 'back_safe_zone';
  if (includesAny(normalized, ['front safe zone', 'front area', '前侧安全区', '前侧', '前方'])) return 'front_safe_zone';
  if (includesAny(normalized, ['left safe zone', 'left area', '左侧安全区', '左侧', '左边'])) return 'left_safe_zone';
  if (includesAny(normalized, ['right safe zone', 'right area', '右侧安全区', '右侧', '右边'])) return 'right_safe_zone';
  if (includesAny(normalized, ['outside table', 'off the table', '桌面外', '扔出桌面'])) return 'outside_table';
  if (includesAny(normalized, ['current area', '当前区域'])) return 'current_area';
  if (includesAny(normalized, ['zone a', 'a 区', 'a区'])) return 'zone_a';
  return undefined;
}

function buildResult(goalType: GoalType, targetDeviceId: string, normalized: string): GoalCompileResult {
  const objectRef = detectObjectRef(normalized);
  const targetZone = detectTargetZone(normalized);
  const desiredState: Record<string, string | number | boolean> = {};

  if (goalType === 'set_color') {
    if (includesAny(normalized, ['blue', '蓝'])) desiredState.color = 'blue';
    if (includesAny(normalized, ['red', '红'])) desiredState.color = 'red';
    if (includesAny(normalized, ['green', '绿'])) desiredState.color = 'green';
  }
  if (goalType === 'set_brightness') {
    desiredState.brightness = includesAny(normalized, ['dim', '暗', '调暗']) ? 20 : 85;
  }

  const precisionRequirement = includesAny(normalized, ['precise', 'precisely', '精准']) ? 'high' : 'medium';
  const ambiguity = goalType === 'ambiguous_action' ? 'ambiguous' : goalType === 'unsupported_goal' ? 'unknown' : 'clear';
  const riskHint = goalType === 'throw_object' || goalType === 'move_outside_workspace' ? 'critical' : precisionRequirement === 'high' ? 'high' : 'low';
  const confidence = ambiguity === 'clear' ? (precisionRequirement === 'high' ? 0.88 : 0.95) : 0.25;

  return {
    goal: {
      goalType,
      targetDeviceId,
      objectRef,
      targetZone,
      desiredState: Object.keys(desiredState).length > 0 ? desiredState : undefined,
      precisionRequirement,
      riskHint,
      ambiguity
    },
    confidence,
    reason: goalType
  };
}

export function compileGoal(input: Pick<OpenRealityRuntimeInput, 'userPrompt' | 'targetDeviceId'>): GoalCompileResult {
  const normalized = normalizePrompt(input.userPrompt);

  if (!normalized || includesAny(normalized, ['do it', 'start', '帮我弄一个', '帮我弄一下', '执行一个'])) {
    return buildResult('ambiguous_action', input.targetDeviceId, normalized);
  }
  if (includesAny(normalized, ['throw', 'toss', 'push it off', 'push off the table', 'knock off', '扔', '抛', 'off the table', 'outside table', '桌面外'])) {
    return buildResult('throw_object', input.targetDeviceId, normalized);
  }
  if (includesAny(normalized, ['smash', 'crush', '砸', '破坏'])) {
    return buildResult('destructive_action', input.targetDeviceId, normalized);
  }
  if (includesAny(normalized, ['turn on', 'switch on', 'light on', 'lamp on', 'power on', 'turn the light on', '打开', '开灯'])) {
    return buildResult('turn_on', input.targetDeviceId, normalized);
  }
  if (includesAny(normalized, ['turn off', 'switch off', 'turn it off', 'shut off', 'light off', 'lamp off', 'power off', '关闭', '关灯'])) {
    return buildResult('turn_off', input.targetDeviceId, normalized);
  }
  if (includesAny(normalized, ['blue light', 'red light', 'green light', 'set the light to', 'make it blue', 'make it red', 'make it green', 'change color', 'change the color', '改成蓝色', '改成红色', '改成绿色'])) {
    return buildResult('set_color', input.targetDeviceId, normalized);
  }
  if (includesAny(normalized, ['brighter', 'brighten', 'dim', 'dimmer', 'set brightness', 'set the brightness', 'brightness to', '调亮', '更亮', '调暗', '更暗'])) {
    return buildResult('set_brightness', input.targetDeviceId, normalized);
  }
  if (includesAny(normalized, ['take a photo', 'take a picture', 'capture snapshot', 'capture a frame', 'capture the area', 'grab a frame', 'photograph', 'snapshot', '拍一张照片', '拍照', '截图', '捕获画面'])) {
    return buildResult('capture_image', input.targetDeviceId, normalized);
  }
  if (includesAny(normalized, ['scan current area', 'scan area', '扫描当前区域', '扫描区域'])) {
    return buildResult('scan_area', input.targetDeviceId, normalized);
  }
  if (includesAny(normalized, ['read camera status', 'read sensor state', 'camera state', '读取摄像头状态', '读取状态', '查看摄像头状态'])) {
    return buildResult('read_state', input.targetDeviceId, normalized);
  }
  if (includesAny(normalized, ['return home', 'return to home', 'go home', 'reset position', 'home position', '回到原点', '回到初始位置', '归位'])) {
    return buildResult('return_home', input.targetDeviceId, normalized);
  }
  if (includesAny(normalized, ['stop', '停止'])) {
    return buildResult('stop', input.targetDeviceId, normalized);
  }
  if (includesAny(normalized, ['put', 'place', 'move the', 'pick up', 'grab', 'drop', 'relocate', '抓取', '放到', '放在', '把'])) {
    return buildResult(
      includesAny(normalized, ['precise', 'precisely', '精准']) ? 'precision_place' : 'pick_and_place',
      input.targetDeviceId,
      normalized
    );
  }
  if (includesAny(normalized, ['play music', '播放音乐'])) {
    return buildResult('unsupported_goal', input.targetDeviceId, normalized);
  }

  return buildResult('ambiguous_action', input.targetDeviceId, normalized);
}
