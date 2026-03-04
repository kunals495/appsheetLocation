const express = require("express");
const axios = require("axios");
const cors = require('cors');
const app = express();

// Middleware
app.use(cors({
  origin: [
    'https://location-url.vercel.app'
  ],
}));
app.use(express.json());
app.use(express.static('public')); // Serve static HTML files

// ==================== CONFIGURATION ====================
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

// AppSheet Configuration
const APPSHEET_CONFIG = {
  APP_ID: '4457f822-c19e-41a7-8789-948186d4a4de',
  APP_KEY: 'V2-sWnep-IOv7C-E5H7a-j9Xwv-vDyM0-klGZM-PFQrd-Qc7zE',
  TABLE_NAME: 'Orders',
  API_URL: 'https://api.appsheet.com/api/v2/apps'
};

// Your deployed HTML page URL
const HTML_PAGE_URL = 'https://location-url.vercel.app/';

// WhatsApp API Configuration
const WHATSAPP_API = {
  URL: 'https://messagesapi.co.in/chat/sendMessage',
  ACCOUNT_ID: '6c486918d7554752954be04b6f4fb627',
  ACCOUNT_NAME: 'office'
};

// ==================== UTILITY FUNCTIONS ====================

// 🔁 Retry function for external API calls
async function sendWithRetry(url, payload, headers, retries = MAX_RETRIES) {
  try {
    console.log(`🚀 Attempt ${MAX_RETRIES - retries + 1} to send message...`);
    const response = await axios.post(url, payload, { headers });
    return response;
  } catch (error) {
    const status = error.response?.status;
    console.error("⚠️ API Error Status:", status || "No response");
    
    if (retries > 0 && (!status || status >= 500)) {
      console.log(`🔁 Retrying in ${RETRY_DELAY / 1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return sendWithRetry(url, payload, headers, retries - 1);
    }
    
    throw error;
  }
}

// 📝 Update AppSheet with Order ID directly
async function updateAppSheetLocationByOrderId(orderId, locationUrl, latitude, longitude) {
  try {
    console.log(`📍 Updating AppSheet Order ID: ${orderId}`);
    
    const payload = {
      Action: "Edit",
      Properties: {
        Locale: "en-US",
        Timezone: "Asia/Kolkata"
      },
      Rows: [{
        "Order ID": orderId,
        LocationURL: locationUrl,
        Latitude: latitude,
        Longitude: longitude,
        LocationReceived: new Date().toISOString()
      }]
    };

    const response = await axios.post(
      `${APPSHEET_CONFIG.API_URL}/${APPSHEET_CONFIG.APP_ID}/tables/${APPSHEET_CONFIG.TABLE_NAME}/Action`,
      payload,
      {
        headers: {
          'ApplicationAccessKey': APPSHEET_CONFIG.APP_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log("✅ AppSheet updated successfully:", response.data);
    return response.data;
  } catch (error) {
    console.error("❌ Failed to update AppSheet:", error.response?.data || error.message);
    throw error;
  }
}

// 📱 Format order items from AppSheet data
function formatOrderItems(orderData) {
  let items = [];
  
  for (let i = 1; i <= 20; i++) {
    const item = orderData[`Item${i}`];
    const quantity = orderData[`Quantity${i}`];
    
    if (item && item.trim() !== '') {
      items.push(`• ${item} - ${quantity}`);
    }
  }
  
  return items.join('\n');
}

// ==================== ENDPOINTS ====================

// 📨 Send order confirmation with location link
app.post("/send-message", async (req, res) => {
  console.log("📩 New order request received at /send-message");
  console.log("🕒 Time:", new Date().toISOString());
  console.log("📦 Request Body:", JSON.stringify(req.body, null, 2));

  try {
    const orderData = req.body;
    
    // Extract data from request
    const customerPhone = orderData.Contact || orderData.phone;
    const customerName = orderData['Customer Name'] || orderData.customerName || orderData.name;
    const orderId = orderData.orderid || orderData['Order ID'] || orderData.orderId || orderData.OrderID;
    
    // Validate required fields
    if (!customerPhone || !customerName || !orderId) {
      console.log("❌ Missing required fields");
      console.log("Available fields:", Object.keys(orderData));
      return res.status(400).json({ 
        success: false,
        error: "Missing required fields: Contact, Customer Name, or Order ID",
        receivedFields: Object.keys(orderData)
      });
    }

    console.log(`📦 Order ID: ${orderId}`);
    console.log(`📱 Customer Phone: ${customerPhone}`);
    console.log(`👤 Customer Name: ${customerName}`);

    const orderItems = formatOrderItems(orderData);
    
    // Create location tracking URL with Order ID
    const locationTrackingUrl = `${HTML_PAGE_URL}?orderId=${encodeURIComponent(orderId)}`;

    // Build WhatsApp message
    const message = `Hello ${customerName},

Thanks for placing order with Sri Navata Agencies. 

📋 Your Order ID: ${orderId}

Your order:
${orderItems}

📍 *IMPORTANT: Share Your Delivery Location*
Please click the link below to share your exact delivery location:

${locationTrackingUrl}

This helps us deliver your order accurately to your doorstep.

Thank you! 🙏`;

    // Clean message
    const cleanedMessage = message
      .replace(/\n\s*\n+/g, "\n")
      .trim();

    console.log("🧹 Cleaned Message:");
    console.log(cleanedMessage);

    // Prepare WhatsApp API payload
    const whatsappPayload = {
      id: WHATSAPP_API.ACCOUNT_ID,
      name: WHATSAPP_API.ACCOUNT_NAME,
      phone: customerPhone,
      message: cleanedMessage
    };

    console.log("📤 Sending to WhatsApp API...");

    // Send WhatsApp message with retry
    const response = await sendWithRetry(
      WHATSAPP_API.URL,
      whatsappPayload,
      { "Content-Type": "application/json" }
    );

    console.log("✅ WhatsApp message sent successfully!");
    console.log(response.data);

    res.json({
      success: true,
      message: "Order confirmation sent with location tracking link",
      locationUrl: locationTrackingUrl,
      orderId: orderId,
      data: response.data
    });

  } catch (error) {
    console.error("🔥 Error in /send-message:");
    console.error(error.response?.data || error.message);
    
    res.status(500).json({
      success: false,
      error: "Failed to send message",
      details: error.response?.data || error.message
    });
  }
});

// 📍 Receive location from HTML page
app.post("/receive-location", async (req, res) => {
  console.log("📍 Location data received at /receive-location");
  console.log("🕒 Time:", new Date().toISOString());
  console.log("📦 Request Body:", JSON.stringify(req.body, null, 2));

  try {
    const { orderId, location, googleMapsUrl, timestamp, userAgent, timezone } = req.body;

    // Validate required fields
    if (!orderId || !location || !googleMapsUrl) {
      console.log("❌ Missing required fields");
      return res.status(400).json({
        success: false,
        error: "Missing required fields: orderId, location, or googleMapsUrl"
      });
    }

    const { latitude, longitude, accuracy } = location;

    console.log(`📦 Order ID: ${orderId}`);
    console.log(`🌍 Location: ${latitude}, ${longitude}`);
    console.log(`🎯 Accuracy: ±${accuracy}m`);
    console.log(`🗺️ Google Maps URL: ${googleMapsUrl}`);

    // Update AppSheet with location data
    try {
      await updateAppSheetLocationByOrderId(orderId, googleMapsUrl, latitude, longitude);
      
      console.log("✅ Location successfully stored in AppSheet");
      
      res.json({
        success: true,
        message: "Location received and stored successfully",
        data: {
          orderId,
          googleMapsUrl,
          latitude,
          longitude,
          receivedAt: new Date().toISOString()
        }
      });

    } catch (appSheetError) {
      console.error("⚠️ AppSheet update failed, but location was received");
      
      res.json({
        success: true,
        warning: "Location received but AppSheet update failed",
        message: "Location data has been logged. Manual update may be required.",
        error: appSheetError.message,
        data: {
          orderId,
          googleMapsUrl,
          latitude,
          longitude
        }
      });
    }

  } catch (error) {
    console.error("🔥 Error in /receive-location:");
    console.error(error.message);
    
    res.status(500).json({
      success: false,
      error: "Failed to process location data",
      details: error.message
    });
  }
});

// 🔍 Endpoint to check location status for an order ID
app.get("/location-status/:orderId", async (req, res) => {
  const orderId = req.params.orderId;
  
  console.log(`🔍 Checking location status for Order ID: ${orderId}`);
  
  try {
    // Query AppSheet for this order
    const payload = {
      Action: "Find",
      Properties: {
        Locale: "en-US",
        Selector: `SELECT(Orders[Order ID], [Order ID] = "${orderId}")`
      },
      Rows: []
    };

    const response = await axios.post(
      `${APPSHEET_CONFIG.API_URL}/${APPSHEET_CONFIG.APP_ID}/tables/${APPSHEET_CONFIG.TABLE_NAME}/Action`,
      payload,
      {
        headers: {
          'ApplicationAccessKey': APPSHEET_CONFIG.APP_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data && response.data.Rows && response.data.Rows.length > 0) {
      const order = response.data.Rows[0];
      
      res.json({
        success: true,
        orderFound: true,
        orderId: order['Order ID'],
        customerName: order['Customer Name'],
        contact: order['Contact'],
        orderDate: order['Order Date'],
        hasLocation: !!order.LocationURL,
        locationUrl: order.LocationURL || null,
        latitude: order.Latitude || null,
        longitude: order.Longitude || null,
        locationReceived: order.LocationReceived || null
      });
    } else {
      res.json({
        success: true,
        orderFound: false,
        message: "No order found with this Order ID"
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to check location status",
      details: error.message
    });
  }
});

// 🏥 Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    endpoints: {
      sendMessage: "/send-message",
      receiveLocation: "/receive-location",
      locationStatus: "/location-status/:orderId"
    }
  });
});

// 🏠 Root endpoint
app.get("/", (req, res) => {
  res.json({
    service: "Sri Navata Agencies - Order Location Tracker",
    version: "3.0",
    status: "running",
    endpoints: {
      health: "GET /health",
      sendMessage: "POST /send-message",
      receiveLocation: "POST /receive-location",
      locationStatus: "GET /location-status/:orderId"
    },
    documentation: "Now uses Order ID as primary identifier"
  });
});

// ==================== ERROR HANDLING ====================

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    requestedUrl: req.url,
    method: req.method
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("🔥 Unhandled Error:");
  console.error(err.stack);
  
  res.status(500).json({
    success: false,
    error: "Internal server error",
    message: err.message
  });
});

// ==================== START SERVER ====================

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log("🚀 ===============================================");
  console.log(`🚀 Sri Navata Agencies Server Started`);
  console.log(`🚀 Port: ${PORT}`);
  console.log(`🚀 Time: ${new Date().toISOString()}`);
  console.log("🚀 ===============================================");
  console.log("");
  console.log("📡 Available Endpoints:");
  console.log(`   GET  http://localhost:${PORT}/`);
  console.log(`   GET  http://localhost:${PORT}/health`);
  console.log(`   POST http://localhost:${PORT}/send-message`);
  console.log(`   POST http://localhost:${PORT}/receive-location`);
  console.log(`   GET  http://localhost:${PORT}/location-status/:orderId`);
  console.log("");
  console.log("⚡ Server is ready to accept requests!");
  console.log("🚀 ===============================================");
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('✅ HTTP server closed');
  });
});
