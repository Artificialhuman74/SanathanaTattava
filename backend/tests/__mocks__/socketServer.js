/** Lightweight Socket.IO mock — no real server started during tests */
module.exports = {
  initSocket:      jest.fn(),
  emitOrderUpdate: jest.fn(),
  emitNotification: jest.fn(),
  getIO: jest.fn(() => ({
    to:   jest.fn(() => ({ emit: jest.fn() })),
    emit: jest.fn(),
  })),
};
