const { storage } = require('../utils/storage.js');

const VALID_TRANSITIONS = {
  'pending':     ['in-progress', 'cancelled'],
  'in-progress': ['ready', 'cancelled'],
  'ready':       ['served', 'cancelled'],
  'served':      [],  // only the payment endpoint may advance served → completed
  'completed':   [],
  'cancelled':   [],
};

function formatOrder(order) {
  if (!order) return null;
  return {
    _id: order.id,
    id: order.id,
    orderId: order.orderId,
    businessId: order.businessId,
    businessType: order.businessType ?? null,
    tableNumber: order.tableNumber ?? null,
    items: order.items ?? [],
    total: order.total,
    status: order.status,
    waiter: order.waiter ?? null,
    note: order.note ?? null,
    transactionId: order.transactionId ?? null,
    cancelReason: order.cancelReason ?? null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    completedAt: order.completedAt ?? null,
  };
}

exports.createOrder = async(req, res) => {
    try {
        const { orderId, businessId, businessType, tableNumber, items, total, waiter, note } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, message: 'Order items are required' });
        }
        if (!total || Number(total) <= 0) {
        return res.status(400).json({ success: false, message: 'Valid total is required' });
        }
        if (!businessId) {
        return res.status(400).json({ success: false, message: 'businessId is required' });
        }

        const resolvedOrderId = orderId || `ORD-${Date.now()}`;

        const existing = await storage.getOrderByOrderId(resolvedOrderId);
        if (existing) {
        return res.status(400).json({ success: false, message: `Order ID "${resolvedOrderId}" already exists` });
        }

        const normalizedItems = items.map(item => ({
        name: String(item.name || ''),
        quantity: Number(item.quantity) || 1,
        price: Number(item.price) || 0,
        ...(item.category != null ? { category: String(item.category) } : {}),
        ...(item.image ? { image: String(item.image) } : {}),
        }));

        const order = await storage.createOrder({
        orderId: resolvedOrderId,
        businessId: String(businessId),
        businessType: businessType ?? null,
        tableNumber: tableNumber ?? null,
        total: Number(total),
        status: 'pending',
        waiter: waiter ?? null,
        note: note ?? null,
        items: normalizedItems,
        });

        res.status(201).json({ success: true, order: formatOrder(order) });
    } catch (error) {
        console.error('❌ Error creating order:', error);
        if (error.code === 'P2002') {
        return res.status(400).json({ success: false, message: 'Order ID already exists' });
        }
        res.status(500).json({ success: false, message: 'Failed to create order', error: error.message });
    }
}

exports.getOrders = async(req, res) => {
    try {
        const { businessId } = req.params;
        const { status, from, to, waiter } = req.query;

        const statuses = status
        ? status.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
        : undefined;

        const orders = await storage.getOrdersByBusiness(businessId, { statuses, from, to, waiter });
        res.json({ success: true, data: orders.map(formatOrder), count: orders.length });
    } catch (error) {
        console.error('❌ Error fetching orders:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch orders', error: error.message });
    }
}

exports.getOrder = async(req, res) => {
    try {
        const { id } = req.params;
        const order = await storage.getOrder(id);
        if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found' });
        }
        res.json({ success: true, order: formatOrder(order) });
    } catch (error) {
        console.error('❌ Error fetching order:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch order', error: error.message });
    }
}

exports.updateOrderStatus = async(req, res) => {
    try {
        const { id } = req.params;
        const { status, reason } = req.body;

        if (!status) {
        return res.status(400).json({ success: false, message: 'status is required' });
        }

        const newStatus = status.toLowerCase();

        const order = await storage.getOrder(id);
        if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const allowed = VALID_TRANSITIONS[order.status] ?? [];
        if (!allowed.includes(newStatus)) {
        return res.status(400).json({
            success: false,
            message: `Cannot transition from "${order.status}" to "${newStatus}". Allowed: ${allowed.join(', ') || 'none'}`
        });
        }

        // served → completed is only via the payment endpoint
        if (newStatus === 'completed') {
        return res.status(400).json({
            success: false,
            message: 'Use POST /api/transactions/create-transaction to complete an order via payment'
        });
        }

        const updateData = { status: newStatus };
        if (newStatus === 'cancelled' && reason) updateData.cancelReason = reason;

        const updated = await storage.updateOrder(id, updateData);
        res.json({ success: true, order: formatOrder(updated) });
    } catch (error) {
        console.error('❌ Error updating order status:', error);
        res.status(500).json({ success: false, message: 'Failed to update order', error: error.message });
    }
}

exports.cancelOrder = async(req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body ?? {};

        const order = await storage.getOrder(id);
        if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found' });
        }
        if (['completed', 'cancelled'].includes(order.status)) {
        return res.status(400).json({
            success: false,
            message: `Cannot cancel a ${order.status} order`
        });
        }

        const updated = await storage.updateOrder(id, {
        status: 'cancelled',
        cancelReason: reason || 'Cancelled',
        });
        res.json({ success: true, message: 'Order cancelled', order: formatOrder(updated) });
    } catch (error) {
        console.error('❌ Error cancelling order:', error);
        res.status(500).json({ success: false, message: 'Failed to cancel order', error: error.message });
    }
}