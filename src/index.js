require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { authenticate } = require('./middleware/auth');
const { errorHandler } = require('./middleware/errorHandler');

// Route imports
const mealsRouter = require('./routes/meals');
const nutritionRouter = require('./routes/nutrition');
const foodsRouter = require('./routes/foods');
const goalsRouter = require('./routes/goals');
const healthRouter = require('./routes/health');
const userRouter = require('./routes/user');
const scanRouter = require('./routes/scan');
const exportRouter = require('./routes/export');

const app = express();
const PORT = process.env.PORT || 3000;

// Global middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Large limit for base64 photo uploads
app.use(morgan('dev'));

// Health check (no auth required)
app.get('/api/v1/health-check', (req, res) => {
  res.json({ status: 'ok', version: '0.1.0', timestamp: new Date().toISOString() });
});

// All API routes require authentication
app.use('/api/v1/meals/scan', authenticate, scanRouter);
app.use('/api/v1/meals', authenticate, mealsRouter);
app.use('/api/v1/nutrition', authenticate, nutritionRouter);
app.use('/api/v1/foods', authenticate, foodsRouter);
app.use('/api/v1/goals', authenticate, goalsRouter);
app.use('/api/v1/health', authenticate, healthRouter);
app.use('/api/v1/user', authenticate, userRouter);
app.use('/api/v1/export', authenticate, exportRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route not found: ${req.method} ${req.path}`,
    },
  });
});

// Global error handler
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║       HealthTrack API v0.1.0          ║
  ║       Running on port ${PORT}            ║
  ║       Environment: ${process.env.NODE_ENV || 'development'}     ║
  ╚═══════════════════════════════════════╝
  `);
});

module.exports = app;
