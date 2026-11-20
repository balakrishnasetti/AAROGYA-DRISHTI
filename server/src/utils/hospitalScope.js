import mongoose from 'mongoose';

export function hospitalScopedFilter(hospitalId, filters = {}) {
  if (!mongoose.isValidObjectId(hospitalId)) {
    throw new TypeError('A valid hospitalId is required for a hospital-scoped query.');
  }

  return { ...filters, hospitalId: new mongoose.Types.ObjectId(hospitalId) };
}
