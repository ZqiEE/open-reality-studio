/**
 * Plain-language coverage for the goal compiler.
 *
 * Lowering the barrier ("say it in plain words and it works") is the core
 * product bet. These are natural phrasings a real user types that previously
 * returned ambiguous_action; each must now resolve to the correct goal.
 *
 * SAFETY REGRESSION (the important half): adding synonyms must NEVER downgrade
 * a dangerous intent. Throw / off-the-table / smash must still resolve to their
 * critical goals — checked before any pick-and-place synonym.
 */
import assert from 'node:assert/strict';
import { compileGoal } from '../../lib/open-reality-runtime/goalCompiler';

function goalOf(prompt: string): string {
  return compileGoal({ userPrompt: prompt, targetDeviceId: 'd' }).goal.goalType;
}

// Newly-supported natural phrasings.
const shouldResolve: Array<[string, string]> = [
  ['turn the light on', 'turn_on'],
  ['power on the light', 'turn_on'],
  ['switch the lamp on', 'turn_on'],
  ['turn it off', 'turn_off'],
  ['shut off the light', 'turn_off'],
  ['make it blue', 'set_color'],
  ['change color to blue', 'set_color'],
  ['set brightness to 50%', 'set_brightness'],
  ['grab a frame', 'capture_image'],
  ['photograph the scene', 'capture_image'],
  ['capture the area', 'capture_image'],
  ['grab the red cube', 'pick_and_place'],
  ['pick up the cube', 'pick_and_place'],
  ['drop the cube in the right zone', 'pick_and_place'],
  ['relocate the blue cube', 'pick_and_place'],
  ['return to home', 'return_home'],
  ['go home', 'return_home'],
  ['reset position', 'return_home']
];
for (const [prompt, expected] of shouldResolve) {
  assert.equal(goalOf(prompt), expected, `"${prompt}" should resolve to ${expected}, got ${goalOf(prompt)}`);
}

// Safety regression: dangerous intents must still resolve to critical goals.
const dangerous: Array<[string, string]> = [
  ['throw the cube off the table', 'throw_object'],
  ['drop the cube off the table', 'throw_object'],
  ['toss it outside table', 'throw_object'],
  ['smash the cube', 'destructive_action']
];
for (const [prompt, expected] of dangerous) {
  assert.equal(goalOf(prompt), expected, `DANGER: "${prompt}" must stay ${expected}, got ${goalOf(prompt)}`);
}

// Existing safe behavior must be unchanged.
assert.equal(goalOf('put the red cube in the back area'), 'pick_and_place', 'existing pick-and-place must be unchanged.');
assert.equal(goalOf('set the light to blue'), 'set_color', 'existing set_color must be unchanged.');
assert.equal(goalOf('take a photo'), 'capture_image', 'existing capture must be unchanged.');
assert.equal(goalOf('precisely place the cube'), 'precision_place', 'precision intent must be preserved.');

console.log(`plain-language goal coverage passed (${shouldResolve.length} new phrasings, ${dangerous.length} danger regressions held).`);
