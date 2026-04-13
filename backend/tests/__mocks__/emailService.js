/** Mock email service — prevents real SMTP calls during tests */
module.exports = {
  sendVerificationEmail:    jest.fn().mockResolvedValue({ messageId: 'test-msg-1' }),
  sendPasswordResetEmail:   jest.fn().mockResolvedValue({ messageId: 'test-msg-2' }),
  sendReviewRequestEmail:   jest.fn().mockResolvedValue({ messageId: 'test-msg-3' }),
  sendDeliveryOtpEmail:     jest.fn().mockResolvedValue({ messageId: 'test-msg-4' }),
  sendOrderConfirmationEmail: jest.fn().mockResolvedValue({ messageId: 'test-msg-5' }),
};
