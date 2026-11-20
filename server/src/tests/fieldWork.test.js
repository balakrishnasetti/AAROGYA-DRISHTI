import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  FieldRegistration,
  Investigation,
  NavigatorActivity,
  User,
} from '../models/index.js';
import {
  catchmentFilter,
  escalateOverdueInvestigations,
  formatDistrictRows,
} from '../routes/fieldWorkRoutes.js';
import { userUpdateSchema } from '../validators/managementValidators.js';

test('optional field roles and operational models are registered', () => {
  for (const role of ['health_worker', 'navigator', 'district_officer']) {
    const user = new User({ fullName: 'Field role', role });
    assert.equal(user.validateSync(), undefined);
  }
  assert.ok(FieldRegistration.schema.indexes().some(([keys, options]) =>
    keys.duplicateHash === 1 && options.unique === true));
  assert.ok(Investigation.schema.path('classificationSetBy'));
  assert.ok(NavigatorActivity.schema.path('encryptedDetails'));
});

test('district aggregates suppress cells under five and expose no patient fields', () => {
  const rows = formatDistrictRows([
    {
      _id: 'Village One',
      registered: 3,
      screened: 2,
      referred: 1,
      investigation: 1,
      patientName: 'Must not be returned',
      patientId: 'patient-secret',
    },
    {
      _id: 'Village Two',
      registered: 6,
      screened: 4,
      referred: 5,
      investigation: 3,
      patientName: 'Must not be returned',
      patientId: 'patient-secret',
    },
  ]);
  const serialized = JSON.stringify(rows);

  assert.deepEqual(rows[0], {
    area: 'Village Two',
    suppressed: false,
    registered: 6,
    screened: null,
    referred: 5,
    investigation: null,
  });
  assert.deepEqual(rows[1], {
    area: null,
    suppressed: true,
    registered: null,
    screened: null,
    referred: null,
    investigation: null,
  });
  assert.doesNotMatch(serialized, /Must not be returned|patient-secret|patientName|patientId/);
  assert.doesNotMatch(serialized, /Village One/);
});

test('field and navigator queries are restricted to administrator-assigned villages', () => {
  const filter = catchmentFilter({
    district: 'District A',
    mandal: 'Mandal B',
    phc: 'PHC C',
    assignedVillages: ['Village 1', 'Village 2'],
  });
  assert.deepEqual(filter, {
    district: 'District A',
    mandal: 'Mandal B',
    phc: 'PHC C',
    village: { $in: ['Village 1', 'Village 2'] },
  });
  assert.throws(
    () => catchmentFilter({ district: 'District A', assignedVillages: [] }),
    (error) => error.code === 'VILLAGES_NOT_ASSIGNED',
  );
});

test('administrator village assignments are trimmed, deduplicated, and bounded', () => {
  assert.deepEqual(
    userUpdateSchema.parse({ assignedVillages: [' Village 1 ', 'Village 1', 'Village 2'] }),
    { assignedVillages: ['Village 1', 'Village 2'] },
  );
  assert.throws(() => userUpdateSchema.parse({ assignedVillages: [''] }));
});

test('overdue investigation escalation notifies only once', async () => {
  const record = {
    _id: new mongoose.Types.ObjectId(),
    createdBy: new mongoose.Types.ObjectId(),
    dueAt: new Date('2026-01-01T00:00:00Z'),
    escalatedAt: null,
    state: 'report_pending',
  };
  const notifications = [];
  const investigationModel = {
    findOne(filter) {
      assert.equal(filter.escalatedAt, null);
      return {
        sort() { return this; },
        async lean() { return record.escalatedAt ? null : { ...record }; },
      };
    },
    async updateOne(filter, update) {
      if (record._id.toString() !== filter._id.toString() || record.escalatedAt !== null) {
        return { modifiedCount: 0 };
      }
      record.escalatedAt = update.$set.escalatedAt;
      return { modifiedCount: 1 };
    },
  };
  const notificationModel = {
    async create(notification) {
      notifications.push(notification);
    },
  };
  const options = {
    investigationModel,
    notificationModel,
    now: new Date('2026-01-02T00:00:00Z'),
  };

  assert.equal((await escalateOverdueInvestigations(options)).length, 1);
  assert.equal((await escalateOverdueInvestigations(options)).length, 0);
  assert.equal(notifications.length, 1);
});
