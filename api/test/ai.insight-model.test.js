// AiInsight schema: engine and knowledge versions, feature snapshot and feedback signals (needs MongoDB; skips when unreachable).
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const AiInsight = require('../src/models/AiInsight');

const uri = (process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/pp_test').replace(/\/pp_test$/, '/pp_test_insight_model');
let connected = false;

test.before(async () => {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 2000 });
    connected = true;
  } catch {
    connected = false;
  }
});

test.after(async () => {
  if (connected) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

const base = () => ({ ticketId: new mongoose.Types.ObjectId(), analysisId: `a-${Math.random()}`, provider: 'local_rules', result: { label: 'low', confidence: 0.4 } });

test('an insight records the engine, knowledge and component versions and a content-free feature snapshot', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  const doc = await AiInsight.create({
    ...base(), type: 'priority', confidence: 0.4,
    engineVersion: '3a.1', knowledgeVersion: 'verification-support@0.1.0+abc123def456', componentVersions: { 'rules-priority': '1.0' },
    featureSnapshot: { messages: { total: 2 }, mentions: { entity: ['passport'] } },
  });
  const stored = await AiInsight.findById(doc._id).lean();
  assert.equal(stored.engineVersion, '3a.1');
  assert.equal(stored.knowledgeVersion, 'verification-support@0.1.0+abc123def456');
  assert.deepEqual(stored.componentVersions, { 'rules-priority': '1.0' });
  assert.deepEqual(stored.featureSnapshot.mentions.entity, ['passport']);
  assert.equal(stored.status, 'suggested');
  assert.deepEqual({ v: stored.feedback.finalValue, e: stored.feedback.editedAt, i: stored.feedback.ignoredAt }, { v: null, e: null, i: null });
});

test('feedback signals can be recorded and no token-usage or prompt fields exist any more', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  const doc = await AiInsight.create({ ...base(), type: 'priority', confidence: 0.4 });
  await AiInsight.updateOne({ _id: doc._id }, { $set: { 'feedback.finalValue': { priority: 'high' }, 'feedback.editedAt': new Date() } });
  const stored = await AiInsight.findById(doc._id).lean();
  assert.deepEqual(stored.feedback.finalValue, { priority: 'high' });
  assert.ok(stored.feedback.editedAt instanceof Date);
  assert.equal('usage' in AiInsight.schema.paths, false);
  assert.equal('promptVersion' in AiInsight.schema.paths, false);
});

test('analysis insights still need a valid confidence and the type is validated', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  await assert.rejects(AiInsight.create({ ...base(), type: 'priority' }), /confidence/);
  await assert.rejects(AiInsight.create({ ...base(), type: 'sentiment', confidence: 1.5 }), /confidence/);
  await assert.rejects(AiInsight.create({ ...base(), type: 'translation' }), /type/);
  const draft = await AiInsight.create({ ...base(), type: 'reply_draft', audience: 'customer', usedInternalNotes: false });
  assert.equal(draft.type, 'reply_draft');
});
