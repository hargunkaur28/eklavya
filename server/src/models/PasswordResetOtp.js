import mongoose from 'mongoose';

const passwordResetOtpSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true },
  otpHash: { type: String, required: true },
  accountType: { type: String, enum: ['student', 'parent'], default: 'student' },
  attempts: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now, expires: '15m' }
});

export default mongoose.model('PasswordResetOtp', passwordResetOtpSchema);
