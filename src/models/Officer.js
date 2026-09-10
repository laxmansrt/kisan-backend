'use strict';
const mongoose = require('mongoose');

const officerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  username: { type: String, required: true, unique: true, index: true },
  password_hash: { type: String, required: true },
  center_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Center', required: true, index: true },
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

module.exports = mongoose.models.Officer || mongoose.model('Officer', officerSchema);
