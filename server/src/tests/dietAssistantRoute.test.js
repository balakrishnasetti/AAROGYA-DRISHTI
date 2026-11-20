import test from 'node:test';
import assert from 'node:assert/strict';
import { executeReadOnlyTool } from '../routes/assistantRoutes.js';

test('diet assistant action opens the patient Diet and Lifestyle page', async () => {
  const result = await executeReadOnlyTool('get_diet_plan', { condition: 'today' });
  assert.equal(result.action.type, 'navigate');
  assert.equal(result.action.href, '/patient/diet');
  assert.match(result.text, /doctor or dietitian/i);
});
