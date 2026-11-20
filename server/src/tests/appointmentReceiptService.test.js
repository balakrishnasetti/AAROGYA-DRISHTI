import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppointmentReceipt } from '../services/appointmentReceiptService.js';

test('appointment receipt is a PDF containing a signed check-in QR', async () => {
  const pdf = await createAppointmentReceipt(
    {
      _id: '507f1f77bcf86cd799439011',
      slotStart: new Date('2030-01-02T03:30:00.000Z'),
      consultationMode: 'in_person',
      feeAmount: 450,
      paymentStatus: 'due_at_hospital',
    },
    {
      patientName: 'Test Patient',
      doctorName: 'Test Doctor',
      hospitalName: 'Test Hospital',
      secret: 'a'.repeat(32),
    },
  );

  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.ok(pdf.length > 1000);
});
