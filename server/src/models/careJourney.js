import mongoose from 'mongoose';
import { objectId } from './shared.js';

export const CARE_JOURNEY_STAGES = Object.freeze([
  'registered',
  'screening_completed',
  'doctor_review',
  'treatment_started',
  'follow_up_pending',
  'case_closed',
]);

const careJourneyTransitionSchema = new mongoose.Schema(
  {
    fromStage: { type: String, enum: CARE_JOURNEY_STAGES, required: true },
    toStage: { type: String, enum: CARE_JOURNEY_STAGES, required: true },
    changedBy: { type: objectId, ref: 'User', required: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    changedAt: { type: Date, required: true },
  },
  { _id: false, strict: 'throw' },
);

export const careJourneySchema = new mongoose.Schema(
  {
    stage: {
      type: String,
      enum: CARE_JOURNEY_STAGES,
      default: 'registered',
      required: true,
    },
    history: { type: [careJourneyTransitionSchema], default: [] },
  },
  { _id: false, strict: 'throw' },
);
