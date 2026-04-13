/** Mock notification service — skips DB writes and Socket.IO during route tests */
module.exports = {
  notifyDealerDeliveryAssigned:    jest.fn().mockResolvedValue(true),
  notifyConsumerDeliveryAssigned:  jest.fn().mockResolvedValue(true),
  notifyLinkedDealerOrderRouted:   jest.fn().mockResolvedValue(true),
  notifyAdminNewOrder:             jest.fn().mockResolvedValue(true),
  createNotification:              jest.fn().mockResolvedValue({ id: 1 }),
  getNotifications:                jest.fn().mockResolvedValue([]),
  getUnreadCount:                  jest.fn().mockResolvedValue(0),
  markRead:                        jest.fn().mockResolvedValue(true),
  markAllRead:                     jest.fn().mockResolvedValue(true),
};
