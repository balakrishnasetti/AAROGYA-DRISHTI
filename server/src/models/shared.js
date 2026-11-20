import mongoose from 'mongoose';

export const objectId = mongoose.Schema.Types.ObjectId;

export const syntheticSchemaOptions = {
  timestamps: true,
  strict: 'throw',
  versionKey: false,
};

export function withSynthetic(fields) {
  return {
    ...fields,
    isSynthetic: { type: Boolean, default: false, required: true, index: true },
  };
}

export function createModel(name, schema) {
  return mongoose.models[name] ?? mongoose.model(name, schema);
}

export function blockMutation(schema, modelName, { allowSyntheticDelete = false } = {}) {
  const reject = function rejectMutation() {
    throw new Error(`${modelName} records are immutable; create a new record instead.`);
  };

  schema.pre('save', function preventResave() {
    if (!this.isNew) reject();
  });

  for (const operation of [
    'update',
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'findOneAndReplace',
    'replaceOne',
  ]) {
    schema.pre(operation, reject);
  }

  for (const operation of ['deleteOne', 'findOneAndDelete']) {
    schema.pre(operation, reject);
  }

  if (allowSyntheticDelete) {
    schema.pre('deleteMany', function onlyDeleteSyntheticRecords() {
      if (this.getFilter().isSynthetic !== true) reject();
    });
  } else {
    schema.pre('deleteMany', reject);
  }

  schema.pre('deleteOne', { document: true, query: false }, reject);
}

export function createTimestampedSchema(fields, options = {}) {
  return new mongoose.Schema(withSynthetic(fields), {
    ...syntheticSchemaOptions,
    ...options,
  });
}
