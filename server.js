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

// AppSheet Configuration (Replace with your actual values)
const APPSHEET_CONFIG = {
  APP_ID: '4457f822-c19e-41a7-8789-948186d4a4de',
  APP_KEY: 'V2-sWnep-IOv7C-E5H7a-j9Xwv-vDyM0-klGZM-PFQrd-Qc7zE',
  TABLE_NAME: 'Orders', // Your orders table name
  API_URL: 'https://api.appsheet.com/api/v2/apps'
};

// Your deployed HTML page URL
const HTML_PAGE_URL = 'https://location-url.vercel.app/';

// WhatsApp API Configuration
const WHATSAPP_API = {
  URL: 'https://messagesapi.co.in/chat/sendMessage',
  ACCOUNT_ID: '6c486918d7554752954be04b6f4fb627', // Your account ID
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
    
    // Retry only if no response (network issue) or 5xx error (server issue)
    if (retries > 0 && (!status || status >= 500)) {
      console.log(`🔁 Retrying in ${RETRY_DELAY / 1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return sendWithRetry(url, payload, headers, retries - 1);
    }
    
    throw error;
  }
}

// 📝 Update AppSheet with location data
async function updateAppSheetLocation(phone, locationUrl, latitude, longitude) {
  try {
    console.log(`📍 Updating AppSheet for phone: ${phone}`);
    
    const payload = {
      Action: "Edit",
      Properties: {
        Locale: "en-US",
        Timezone: "Asia/Kolkata"
      },
      Rows: [{
        Contact: phone,
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

// 📨 Original endpoint: Send order confirmation with location link
app.post("/send-message", async (req, res) => {
  console.log("📩 New order request received at /send-message");
  console.log("🕒 Time:", new Date().toISOString());
  console.log("📦 Request Body:", JSON.stringify(req.body, null, 2));

  try {
    const orderData = req.body;
    
    // Handle both possible field name formats
    const customerPhone = orderData.Contact || orderData.phone || orderData['91<<[Contact]>>'];
    const customerName = orderData['Customer Name'] || orderData.customerName || orderData.name;
    
    // Validate required fields
    if (!customerPhone || !customerName) {
      console.log("❌ Missing required fields");
      console.log("Available fields:", Object.keys(orderData));
      return res.status(400).json({ 
        success: false,
        error: "Missing required fields: Contact or Customer Name",
        receivedFields: Object.keys(orderData)
      });
    }

    const orderItems = formatOrderItems(orderData);
    // Create location tracking URL with phone number
    const locationTrackingUrl = `${HTML_PAGE_URL}?phone=${encodeURIComponent(customerPhone)}`;

    // Build WhatsApp message
    const message = `Hello ${customerName},

Thanks for placing order with Sri Navata Agencies. 

📋 Your order:
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

// 📍 NEW ENDPOINT: Receive location from HTML page
app.post("/receive-location", async (req, res) => {
  console.log("📍 Location data received at /receive-location");
  console.log("🕒 Time:", new Date().toISOString());
  console.log("📦 Request Body:", JSON.stringify(req.body, null, 2));

  try {
    const { phone, location, googleMapsUrl, timestamp, userAgent, timezone } = req.body;

    // Validate required fields
    if (!phone || !location || !googleMapsUrl) {
      console.log("❌ Missing required fields");
      return res.status(400).json({
        success: false,
        error: "Missing required fields: phone, location, or googleMapsUrl"
      });
    }

    const { latitude, longitude, accuracy } = location;

    console.log(`📱 Customer Phone: ${phone}`);
    console.log(`🌍 Location: ${latitude}, ${longitude}`);
    console.log(`🎯 Accuracy: ±${accuracy}m`);
    console.log(`🗺️ Google Maps URL: ${googleMapsUrl}`);

    // Update AppSheet with location data
    try {
      await updateAppSheetLocation(phone, googleMapsUrl, latitude, longitude);
      
      console.log("✅ Location successfully stored in AppSheet");
      
      res.json({
        success: true,
        message: "Location received and stored successfully",
        data: {
          phone,
          googleMapsUrl,
          latitude,
          longitude,
          receivedAt: new Date().toISOString()
        }
      });

    } catch (appSheetError) {
      // Even if AppSheet update fails, acknowledge receipt
      console.error("⚠️ AppSheet update failed, but location was received");
      
      res.json({
        success: true,
        warning: "Location received but AppSheet update failed",
        message: "Location data has been logged. Manual update may be required.",
        data: {
          phone,
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

// 🔍 Endpoint to check location status for a phone number
app.get("/location-status/:phone", async (req, res) => {
  const phone = req.params.phone;
  
  console.log(`🔍 Checking location status for: ${phone}`);
  
  // In a real application, you would query your database
  // For now, we'll return a basic response
  
  res.json({
    success: true,
    phone: phone,
    message: "Location status check endpoint",
    note: "Implement database query to check if location has been received"
  });
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
      locationStatus: "/location-status/:phone"
    }
  });
});

// 🏠 Root endpoint
app.get("/", (req, res) => {
  res.json({
    service: "Sri Navata Agencies - Order Location Tracker",
    version: "2.0",
    status: "running",
    endpoints: {
      health: "GET /health",
      sendMessage: "POST /send-message",
      receiveLocation: "POST /receive-location",
      locationStatus: "GET /location-status/:phone"
    },
    documentation: "See README.md for API documentation"
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

app.listen(PORT, () => {
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
  console.log(`   GET  http://localhost:${PORT}/location-status/:phone`);
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
