import { createHmac } from 'node:crypto';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

function checkInToken(appointmentId, secret) {
  const payload = `AAROGYA-CHECKIN:${appointmentId}`;
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}:${signature}`;
}

export async function createAppointmentReceipt(appointment, { patientName, doctorName, hospitalName, secret }) {
  const qrBuffer = await QRCode.toBuffer(checkInToken(appointment._id.toString(), secret), {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 240,
  });
  const doc = new PDFDocument({ margin: 48, size: 'A4' });
  const chunks = [];

  return new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    doc.fontSize(22).text('Aarogya Drishti', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(17).text('Appointment receipt', { align: 'center' });
    doc.moveDown();
    doc.fontSize(11).text(`Appointment ID: ${appointment._id}`);
    doc.moveDown(0.75);
    doc.fontSize(12).text(`Patient: ${patientName}`);
    doc.text(`Doctor: ${doctorName}`);
    doc.text(`Hospital: ${hospitalName}`);
    doc.text(`Date and time: ${new Date(appointment.slotStart).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} (IST)`);
    doc.text(`Consultation: ${appointment.consultationMode === 'video' ? 'Video consultation' : 'In person'}`);
    doc.text(`Fee: INR ${Number(appointment.feeAmount ?? 0).toFixed(2)}`);
    doc.text(`Payment: ${appointment.paymentStatus === 'paid' ? 'Paid' : 'Pay at hospital'}`);
    doc.moveDown();
    doc.fontSize(10).text('Show this QR code to authorized staff at check-in. It contains a signed appointment reference, not patient details.');
    doc.image(qrBuffer, { fit: [140, 140], align: 'center' });
    doc.moveDown();
    doc.fontSize(9).text('This receipt confirms an appointment request or booking only. It is not a diagnosis or emergency-care service.');
    doc.end();
  });
}
