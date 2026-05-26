/** Mock email service — prevents real SMTP calls during tests */
module.exports = {
  sendVerificationEmail:           jest.fn().mockResolvedValue({ messageId: 'test-msg-1' }),
  sendPasswordResetEmail:          jest.fn().mockResolvedValue({ messageId: 'test-msg-2' }),
  sendReviewRequestEmail:          jest.fn().mockResolvedValue({ messageId: 'test-msg-3' }),
  sendDeliveryOtpEmail:            jest.fn().mockResolvedValue({ messageId: 'test-msg-4' }),
  sendOrderConfirmationEmail:      jest.fn().mockResolvedValue({ messageId: 'test-msg-5' }),
  sendCommissionConfirmationEmail: jest.fn().mockResolvedValue({ messageId: 'test-msg-6' }),
  sendCommissionDisputeEmail:      jest.fn().mockResolvedValue({ messageId: 'test-msg-7' }),
  sendAdminStockAlert:             jest.fn().mockResolvedValue({ messageId: 'test-msg-8' }),
  sendAdminLowStockEmail:          jest.fn().mockResolvedValue({ messageId: 'test-msg-9' }),
  sendOrderConfirmedEmail:         jest.fn().mockResolvedValue({ messageId: 'test-msg-10' }),
  sendOutForDeliveryEmail:         jest.fn().mockResolvedValue({ messageId: 'test-msg-11' }),
  sendInvoiceEmail:                jest.fn().mockResolvedValue({ messageId: 'test-msg-12' }),
  sendContainerRefundRequestEmail: jest.fn().mockResolvedValue({ messageId: 'test-msg-13' }),
  sendAdminDamageReportEmail:      jest.fn().mockResolvedValue({ messageId: 'test-msg-14' }),
  sendAdminDisputeOpenedEmail:     jest.fn().mockResolvedValue({ messageId: 'test-msg-15' }),
  DEV_MODE: false,
};
