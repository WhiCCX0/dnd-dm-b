import test from 'node:test';
import assert from 'node:assert/strict';
import { textToSpeech, VOICE_PRESETS } from '../scripts/speak-npc.js';

test('speak-npc - 预设音色库完整性', () => {
  assert.ok(VOICE_PRESETS.default, '应包含 default 音色');
  assert.ok(VOICE_PRESETS.goblin, '应包含 goblin 音色');
  assert.ok(VOICE_PRESETS.wizard, '应包含 wizard 音色');
  assert.ok(VOICE_PRESETS.guard, '应包含 guard 音色');
});

test('speak-npc - 静音/无声输出模式安全执行', async () => {
  await assert.doesNotReject(async () => {
    await textToSpeech('测试台词', 'default', { npc: '测试NPC', noSound: true });
  });
});
