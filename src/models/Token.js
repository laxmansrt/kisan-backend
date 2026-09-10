'use strict';
const mongoose = require('mongoose');

const tokenSchema = new mongoose.Schema({
  registration_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CropRegistration', required: true, unique: true, index: true },
  slot_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Slot', required: true, index: true },
  token_number: { type: Number, required: true },
  actual_quantity: { type: Number },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  toJSON: {
    virtuals: true,
    transform: (doc, ret) => {
      ret.id = ret._id ? ret._id.toString() : ret.id;
      return ret;
    },
  },
  toObject: {
    virtuals: true,
    transform: (doc, ret) => {
      ret.id = ret._id ? ret._id.toString() : ret.id;
      return ret;
    },
  },
});

tokenSchema.index({ slot_id: 1, token_number: 1 }, { unique: true });

module.exports = mongoose.models.Token || mongoose.model('Token', tokenSchema);
