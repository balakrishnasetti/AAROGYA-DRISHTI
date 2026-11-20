import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  appointmentScopeFilter,
  doctorScopeFilter,
  hospitalDocumentFilter,
} from '../services/managementService.js';
import {
  createDoctorSchema,
  createHospitalSchema,
  updateManagerHospitalSchema,
  updateHospitalSchema,
} from '../validators/managementValidators.js';
import { createPrivateStorageService } from '../services/privateStorageService.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { ApiError } from '../utils/apiError.js';
import { Hospital } from '../models/index.js';

test('manager hospital edits cannot change hospital assignment or activation state', () => {
  assert.equal(updateManagerHospitalSchema.safeParse({ status: 'inactive' }).success, false);
  assert.equal(
    updateManagerHospitalSchema.safeParse({ hospitalId: new mongoose.Types.ObjectId().toString() })
      .success,
    false,
  );
  assert.equal(updateManagerHospitalSchema.safeParse({ workingHours: [] }).success, true);
});

test('management input cannot supply server-owned hospital, role, or status fields', () => {
  const doctor = {
    fullName: 'Synthetic Doctor',
    email: 'doctor@example.test',
    phone: '+919876543210',
    qualification: 'BDS',
    registrationNumber: 'REG-001',
    hospitalId: new mongoose.Types.ObjectId().toString(),
  };
  assert.equal(createDoctorSchema.safeParse(doctor).success, false);

  const hospital = {
    hospital: {
      name: 'Synthetic Hospital',
      address: '1 Example Road',
      city: 'Hyderabad',
      state: 'Telangana',
      postalCode: '500001',
      code: 'CLIENT-CONTROLLED',
    },
    manager: {
      fullName: 'Synthetic Manager',
      email: 'manager@example.test',
      phone: '+919876543211',
    },
  };
  assert.equal(createHospitalSchema.safeParse(hospital).success, false);

  assert.equal(
    createHospitalSchema.safeParse({
      hospital: {
        name: 'Draft PHC',
        centerType: 'phc',
        address: 'PHC Draft',
        city: 'Draft',
        state: 'Andhra Pradesh',
        postalCode: '000000',
      },
      manager: {
        fullName: 'Synthetic Manager',
        email: 'manager@example.test',
        phone: '+919876543211',
      },
    }).success,
    true,
  );
  assert.equal(
    updateHospitalSchema.safeParse({
      address: '',
      city: '',
      postalCode: '',
      status: 'inactive',
    }).success,
    true,
  );

  const importedDraft = new Hospital({
    name: 'PHC ANANTHAGIRI',
    code: 'IN2810003041',
    facilityType: 'phc',
    centerType: 'phc',
    state: 'Andhra Pradesh',
    district: 'Alluri Sitarama Raju District',
    status: 'inactive',
    importSource: {
      sourceFile: 'Medical Officer HPRID Status .xlsx',
      sheetName: 'Sheet1',
      rowNumber: 2,
      originalFacilityName: 'PHC ANANTHAGIRI',
      canonicalFacilityName: 'PHC ANANTHAGIRI',
    },
  });
  assert.equal(importedDraft.validateSync(), undefined);
});

test('hospital manager doctor and appointment filters always retain assigned hospital', () => {
  const hospitalId = new mongoose.Types.ObjectId();
  const anotherHospitalId = new mongoose.Types.ObjectId();
  const doctorId = new mongoose.Types.ObjectId();

  const doctorFilter = doctorScopeFilter(hospitalId, doctorId);
  assert.equal(doctorFilter.userId.toString(), doctorId.toString());
  assert.equal(doctorFilter.hospitalId.toString(), hospitalId.toString());

  const appointmentFilter = appointmentScopeFilter(hospitalId, {
    hospitalId: anotherHospitalId,
    status: 'requested',
  });
  assert.equal(appointmentFilter.hospitalId.toString(), hospitalId.toString());
  assert.equal(appointmentFilter.status, 'requested');
});

test('hospital manager profile queries use the hospital document ID', () => {
  const hospitalId = new mongoose.Types.ObjectId();
  const filter = hospitalDocumentFilter({ hospitalId });

  assert.equal(filter._id.toString(), hospitalId.toString());
  assert.equal('hospitalId' in filter, false);
  assert.throws(
    () => hospitalDocumentFilter({}),
    (error) => error.code === 'HOSPITAL_NOT_ASSIGNED',
  );
});

test('doctor uploads reject spoofed file types and require configured private storage', async () => {
  const storage = createPrivateStorageService({
    NODE_ENV: 'production',
    STORAGE_BACKEND: 's3',
  });
  await assert.rejects(
    storage.storeDoctorFile({
      hospitalId: new mongoose.Types.ObjectId(),
      doctorId: new mongoose.Types.ObjectId(),
      kind: 'qualification',
      file: { mimetype: 'application/pdf', buffer: Buffer.from('not a PDF') },
    }),
    (error) => error.code === 'FILE_TYPE_INVALID',
  );
  await assert.rejects(
    storage.storeDoctorFile({
      hospitalId: new mongoose.Types.ObjectId(),
      doctorId: new mongoose.Types.ObjectId(),
      kind: 'qualification',
      file: { mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.7 synthetic') },
    }),
    (error) => error.code === 'PRIVATE_STORAGE_UNAVAILABLE',
  );
});

test('upload and duplicate errors use the safe API error shape', () => {
  function responseFor(error) {
    let response;
    errorHandler(
      error,
      {},
      {
        headersSent: false,
        status(status) {
          response = { status };
          return this;
        },
        json(body) {
          response.body = body;
          return response;
        },
      },
      () => {},
    );
    return response;
  }

  const uploadResponse = responseFor({ name: 'MulterError', code: 'LIMIT_UNEXPECTED_FILE' });
  assert.equal(uploadResponse.status, 400);
  assert.equal(uploadResponse.body.code, 'FILE_UPLOAD_INVALID');
  assert.equal(Object.keys(uploadResponse.body).sort().join(','), 'code,details,message,success');

  const duplicateResponse = responseFor({ code: 11000, keyPattern: { email: 1 } });
  assert.equal(duplicateResponse.status, 409);
  assert.deepEqual(duplicateResponse.body.details, { fields: ['email'] });

  const serviceResponse = responseFor(
    new ApiError(503, 'SMS_UNAVAILABLE', 'Sign-in code delivery is not configured.'),
  );
  assert.equal(serviceResponse.status, 503);
  assert.equal(serviceResponse.body.code, 'SMS_UNAVAILABLE');
  assert.equal(serviceResponse.body.message, 'Sign-in code delivery is not configured.');

  const internalResponse = responseFor(new Error('private database details'));
  assert.equal(internalResponse.status, 500);
  assert.equal(internalResponse.body.code, 'INTERNAL_SERVER_ERROR');
  assert.doesNotMatch(internalResponse.body.message, /private database details/);
});
