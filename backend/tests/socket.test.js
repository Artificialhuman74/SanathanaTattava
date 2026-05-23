/**
 * Part 16 — Real-time & Socket.IO
 *
 * The socket server is mocked via Jest's moduleNameMapper.
 * We test that the correct routes call emitOrderUpdate with the right arguments.
 */
const request = require('supertest');
const { createApp } = require('./helpers/app');
const factory = require('./helpers/factory');
const { emitOrderUpdate } = require('../src/websocket/socketServer'); // resolves to mock

let app;

beforeAll(() => {
  app = createApp();
});

beforeEach(() => {
  factory.clearAll();
  jest.clearAllMocks();
});

describe('Socket.IO — emitOrderUpdate via trader route', () => {
  test('PUT /api/trader/consumer-orders/:id/status with status=confirmed calls emitOrderUpdate once', async () => {
    const { user: trader, headers } = factory.createTrader();
    const { consumer } = factory.createConsumer({ linked_dealer_id: trader.id });
    const order = factory.createConsumerOrder(consumer.id, {
      linked_dealer_id: trader.id,
      delivery_dealer_id: trader.id,
      status: 'pending',
    });

    const res = await request(app)
      .put(`/api/trader/consumer-orders/${order.id}/status`)
      .set(headers)
      .send({ status: 'confirmed' });

    expect(res.status).toBe(200);
    expect(emitOrderUpdate).toHaveBeenCalledTimes(1);
    expect(emitOrderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: order.id, status: 'confirmed' })
    );
  });

  test('emitOrderUpdate is called with linked_dealer_id and delivery_dealer_id fields', async () => {
    const { user: trader } = factory.createTrader();
    const { user: deliveryTrader } = factory.createTrader();
    const { consumer } = factory.createConsumer({ linked_dealer_id: trader.id });
    const order = factory.createConsumerOrder(consumer.id, {
      linked_dealer_id: trader.id,
      delivery_dealer_id: deliveryTrader.id,
      status: 'pending',
    });

    const { headers } = factory.createAdmin();
    const res = await request(app)
      .put(`/api/admin/consumer-orders/${order.id}/status`)
      .set(headers)
      .send({ status: 'confirmed' });

    expect(res.status).toBe(200);
    expect(emitOrderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: order.id,
        linkedDealerId: trader.id,
        deliveryDealerId: deliveryTrader.id,
      })
    );
  });

  test('PUT /api/trader/consumer-orders/:id/status with invalid status does NOT call emitOrderUpdate', async () => {
    const { user: trader, headers } = factory.createTrader();
    const { consumer } = factory.createConsumer({ linked_dealer_id: trader.id });
    const order = factory.createConsumerOrder(consumer.id, {
      linked_dealer_id: trader.id,
      delivery_dealer_id: trader.id,
      status: 'pending',
    });

    const res = await request(app)
      .put(`/api/trader/consumer-orders/${order.id}/status`)
      .set(headers)
      .send({ status: 'flying' });

    expect(res.status).toBe(400);
    expect(emitOrderUpdate).not.toHaveBeenCalled();
  });
});

describe('Socket.IO — emitOrderUpdate via admin route', () => {
  test('PUT /api/admin/consumer-orders/:id/status with status=cancelled calls emitOrderUpdate with status=cancelled', async () => {
    const { headers: adminHeaders } = factory.createAdmin();
    const { consumer } = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.id, {
      status: 'pending',
    });

    const res = await request(app)
      .put(`/api/admin/consumer-orders/${order.id}/status`)
      .set(adminHeaders)
      .send({ status: 'cancelled' });

    expect(res.status).toBe(200);
    expect(emitOrderUpdate).toHaveBeenCalledTimes(1);
    expect(emitOrderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: order.id, status: 'cancelled' })
    );
  });
});

describe('Socket auth — bad JWT returns 401 on protected routes', () => {
  test('request with bad token to trader route returns 401', async () => {
    const { consumer } = factory.createConsumer();
    const order = factory.createConsumerOrder(consumer.id, { status: 'pending' });

    const res = await request(app)
      .put(`/api/trader/consumer-orders/${order.id}/status`)
      .set('Authorization', 'Bearer invalid.jwt.token')
      .send({ status: 'confirmed' });

    expect(res.status).toBe(401);
    expect(emitOrderUpdate).not.toHaveBeenCalled();
  });

  test('request with no token to admin route returns 401', async () => {
    const res = await request(app)
      .get('/api/admin/stats');

    expect(res.status).toBe(401);
  });
});
