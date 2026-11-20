import cron from 'node-cron';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { connectDatabase } from './config/database.js';
import { loadEnv } from './config/env.js';
import { escalateOverdueInvestigations } from './routes/fieldWorkRoutes.js';
import { sendAppointmentReminders } from './jobs/appointmentReminders.js';
import { createConsultationSocketServer } from './services/consultationSocket.js';
import { createWebPushService } from './services/webPushService.js';
import { ConsultationRequest } from './models/index.js';
import { createPrivateStorageService } from './services/privateStorageService.js';

async function startServer() {
  let environment;

  try {
    environment = loadEnv();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  try {
    await connectDatabase(environment.MONGO_URI);
  } catch {
    console.error(
      'Unable to connect to MongoDB. Check MONGO_URI and ensure the database is running.',
    );
    process.exitCode = 1;
    return;
  }

  const storage = await createPrivateStorageService(environment).initialize();
  if (storage.status === 'available') {
    console.info(`Private storage backend active: ${storage.backend}.`);
  } else {
    console.error(`Private storage unavailable (${storage.backend}): ${storage.reason}.`);
  }

  cron.schedule('*/15 * * * *', () => {
    escalateOverdueInvestigations().catch((error) => {
      console.error(`Investigation escalation job failed: ${error.message}`);
    });
  });
  cron.schedule('0 * * * *', () => {
    sendAppointmentReminders().catch((error) => {
      console.error(`Appointment reminder job failed: ${error.message}`);
    });
  });
  cron.schedule('*/5 * * * *', () => {
    ConsultationRequest.updateMany(
      { status: 'pending', expiresAt: { $lte: new Date() } },
      { $set: { status: 'expired' } },
    ).catch((error) => {
      console.error(`Consultation request expiry job failed: ${error.message}`);
    });
  });

  const app = createApp(environment);
  const httpServer = createServer(app);
  const socketOrigins =
    environment.NODE_ENV === 'development'
      ? [...new Set([environment.CLIENT_URL, 'http://localhost:5173', 'http://127.0.0.1:5173'])]
      : environment.CLIENT_URL;
  const io = new Server(httpServer, {
    cors: { origin: socketOrigins, credentials: true },
    maxHttpBufferSize: 300_000,
  });
  app.set('io', createConsultationSocketServer(io, environment));
  app.set('pushService', createWebPushService(environment));
  httpServer.listen(environment.PORT, '0.0.0.0', () => {
    console.info(`Aarogya Drishti API listening on port ${environment.PORT}`);
  });
}

startServer();
