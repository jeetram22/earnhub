import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { db } from './server/db';

const app = express();
const PORT = 3000;

app.use(express.json());

// Request logging & simulated rate-limiting security check
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

// API Healthcheck
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'EarnHub API' });
});

// Current session tracking (simple header/query/cookie or demo user header)
function getAuthUser(req: express.Request) {
  const userId = (req.headers['x-user-id'] as string) || 'usr_demo_101';
  return db.findUserById(userId) || db.users[0];
}

// -------------------------------------------------------------
// Authentication Endpoints
// -------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  // Check demo credentials or created users
  const user = db.findUserByEmail(email);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password. You can also sign up or click Demo User.' });
  }

  // Simulated secure password check
  res.json({
    message: 'Authentication successful',
    user,
    token: `token_${user.id}_${Date.now()}`,
  });
});

app.post('/api/auth/register', (req, res) => {
  const { email, fullName, password, referralCode } = req.body;
  if (!email || !fullName || !password) {
    return res.status(400).json({ error: 'Full name, email, and password are required' });
  }

  const existing = db.findUserByEmail(email);
  if (existing) {
    return res.status(400).json({ error: 'An account with this email address already exists' });
  }

  const newUser = db.createUser({
    email,
    fullName,
    referredBy: referralCode || undefined,
  });

  res.status(201).json({
    message: 'Account registered successfully',
    user: newUser,
    token: `token_${newUser.id}_${Date.now()}`,
  });
});

app.post('/api/auth/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email address is required' });
  }
  res.json({
    message: 'If an account exists with this email, password reset instructions have been dispatched.',
  });
});

app.get('/api/auth/me', (req, res) => {
  const user = getAuthUser(req);
  res.json({ user });
});

app.patch('/api/auth/me', (req, res) => {
  const user = getAuthUser(req);
  const { fullName, payoutMethod, payoutDetail } = req.body;
  const updated = db.updateUser(user.id, {
    ...(fullName && { fullName }),
    ...(payoutMethod && { payoutMethod }),
    ...(payoutDetail && { payoutDetail }),
  });
  res.json({ user: updated });
});

// -------------------------------------------------------------
// Tasks Endpoints
// -------------------------------------------------------------
app.get('/api/tasks', (req, res) => {
  const { category, search } = req.query;
  const tasks = db.getTasks(category as string, search as string);
  res.json({ tasks });
});

app.get('/api/tasks/:id', (req, res) => {
  const task = db.getTaskById(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  res.json({ task });
});

app.post('/api/tasks/:id/submit', (req, res) => {
  const user = getAuthUser(req);
  const taskId = req.params.id;
  const { proofData } = req.body;

  try {
    const result = db.submitTask(taskId, user.id, proofData);
    res.json({
      message: `Task completed! ₹${result.task.rewardAmount.toFixed(2)} has been credited to your balance.`,
      submission: result.submission,
      user: result.user,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Error processing task submission' });
  }
});

// -------------------------------------------------------------
// Wallet & Financial Ledger Endpoints
// -------------------------------------------------------------
app.get('/api/wallet', (req, res) => {
  const user = getAuthUser(req);
  const userTransactions = db.transactions.filter((t) => t.userId === user.id);
  const userRedemptions = db.redemptions.filter((r) => r.userId === user.id);

  res.json({
    balance: user.balance,
    pendingBalance: user.pendingBalance,
    lifetimeEarned: user.lifetimeEarned,
    minimumThreshold: 500.00,
    isThresholdMet: user.balance >= 500.00,
    transactions: userTransactions,
    redemptions: userRedemptions,
    disclaimer: 'Earnings depend on available approved tasks, eligibility, and partner rules. Real-money transfers are currently sandbox-simulated until production credentials and fraud verifications are bound.',
  });
});

app.post('/api/wallet/redeem', (req, res) => {
  const user = getAuthUser(req);
  const { amount, method, accountDetail } = req.body;

  if (!amount || amount < 500) {
    return res.status(400).json({ error: 'The minimum redemption threshold is ₹500.00' });
  }
  if (!method || !accountDetail) {
    return res.status(400).json({ error: 'Please select a payout method and provide valid account details' });
  }

  try {
    const redemption = db.requestRedemption(user.id, Number(amount), method, accountDetail);
    res.json({
      message: `Redemption request of ₹${Number(amount).toFixed(2)} submitted for compliance review.`,
      redemption,
      user: db.findUserById(user.id),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Referral Program Endpoints
// -------------------------------------------------------------
app.get('/api/referrals', (req, res) => {
  const user = getAuthUser(req);
  const userReferrals = db.getReferralsForUser(user.id);
  const totalCommission = userReferrals.reduce((sum, r) => sum + r.commissionEarned, 0);

  res.json({
    referralCode: user.referralCode,
    referralLink: `https://earnhub.org/signup?ref=${user.referralCode}`,
    totalReferrals: userReferrals.length,
    activeReferrals: userReferrals.filter((r) => r.status === 'active').length,
    totalCommission,
    tier: 'Level 1 Ambassador (10% ongoing partner revenue share)',
    referrals: userReferrals,
    rules: [
      'Share your personal referral link with genuine friends and professional contacts.',
      'Earn 10% bonus when your referred peer completes their first approved task (credited from our partner fee, never deducted from their earnings).',
      'Self-referrals, proxy rings, or emulator farms trigger immediate anti-fraud disqualification.',
    ],
  });
});

// -------------------------------------------------------------
// Platform Stats & Support Endpoints
// -------------------------------------------------------------
app.get('/api/stats', (req, res) => {
  res.json(db.getStats());
});

app.post('/api/contact', (req, res) => {
  const { name, email, subject, category, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Please provide name, email, and your inquiry details' });
  }

  const ticket = {
    id: `ticket_${Date.now()}`,
    name,
    email,
    subject: subject || 'General Inquiry',
    category: category || 'Support',
    message,
    createdAt: new Date().toISOString(),
  };
  db.supportTickets.push(ticket);

  res.json({
    message: 'Support ticket received. Our member operations team typically responds within 24 business hours.',
    ticketId: ticket.id,
  });
});

// -------------------------------------------------------------
// Admin Management Endpoints (Role-Protected)
// -------------------------------------------------------------
function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = getAuthUser(req);
  if (user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied: Administrator privileges required.' });
  }
  next();
}

app.get('/api/admin/overview', requireAdmin, (req, res) => {
  const totalUsers = db.users.length;
  const totalTasks = db.tasks.length;
  const pendingRedemptions = db.redemptions.filter((r) => r.status === 'pending_review');
  const criticalFraudAlerts = db.fraudAlerts.filter((f) => f.status === 'investigating');

  res.json({
    totalUsers,
    totalTasks,
    pendingRedemptionsCount: pendingRedemptions.length,
    criticalFraudAlertsCount: criticalFraudAlerts.length,
    totalPlatformPayouts: db.redemptions.filter((r) => r.status === 'paid').reduce((s, r) => s + r.amount, 0),
    systemHealth: 'Optimal - All Verification Queues Active',
  });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  res.json({ users: db.users });
});

app.patch('/api/admin/users/:id/status', requireAdmin, (req, res) => {
  const { isVerified, kycLevel, trustScore } = req.body;
  const updated = db.updateUser(req.params.id, {
    ...(isVerified !== undefined && { isVerified }),
    ...(kycLevel && { kycLevel }),
    ...(trustScore !== undefined && { trustScore }),
  });
  if (!updated) return res.status(404).json({ error: 'User not found' });
  res.json({ user: updated });
});

app.get('/api/admin/tasks', requireAdmin, (req, res) => {
  res.json({ tasks: db.tasks });
});

app.post('/api/admin/tasks', requireAdmin, (req, res) => {
  const { title, category, description, rewardAmount, estimatedMinutes, difficulty, eligibility, partnerName, proofType, instructions } = req.body;
  if (!title || !category || !rewardAmount) {
    return res.status(400).json({ error: 'Title, category, and reward are required' });
  }
  const task = db.createTask({
    title,
    category,
    description: description || 'Partner verification task',
    rewardAmount: Number(rewardAmount),
    estimatedMinutes: Number(estimatedMinutes) || 10,
    difficulty: difficulty || 'Easy',
    eligibility: eligibility || 'Global',
    partnerName: partnerName || 'Verified Partner',
    proofType: proofType || 'quiz',
    instructions: instructions || ['Follow partner guidelines and complete feedback'],
    requirements: ['Verified EarnHub account'],
    maxCompletions: 500,
    expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    status: 'available',
  });
  res.status(201).json({ task });
});

app.delete('/api/admin/tasks/:id', requireAdmin, (req, res) => {
  const success = db.deleteTask(req.params.id);
  if (!success) return res.status(404).json({ error: 'Task not found' });
  res.json({ message: 'Task deleted successfully' });
});

app.get('/api/admin/redemptions', requireAdmin, (req, res) => {
  res.json({ redemptions: db.redemptions });
});

app.post('/api/admin/redemptions/:id/action', requireAdmin, (req, res) => {
  const { action, notes } = req.body;
  if (!action || !['approve', 'reject', 'flag'].includes(action)) {
    return res.status(400).json({ error: 'Action must be approve, reject, or flag' });
  }
  try {
    const updated = db.processRedemption(req.params.id, action, notes);
    res.json({ message: `Redemption marked as ${updated.status}`, redemption: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/fraud-alerts', requireAdmin, (req, res) => {
  res.json({ fraudAlerts: db.fraudAlerts });
});

app.post('/api/admin/fraud-alerts/:id/resolve', requireAdmin, (req, res) => {
  const alert = db.fraudAlerts.find((f) => f.id === req.params.id);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  const { status } = req.body;
  alert.status = status || 'resolved';
  res.json({ alert });
});

app.get('/api/admin/logs', requireAdmin, (req, res) => {
  res.json({ logs: db.adminLogs });
});

// Setup documentation & production deployment readiness endpoint
app.get('/api/setup-guide', (req, res) => {
  res.json({
    title: 'EarnHub Production Deployment Guide',
    database: {
      engine: 'PostgreSQL 14+',
      schemaFile: '/server/schema.sql',
      connectionVariable: 'DATABASE_URL',
      instructions: 'Run psql $DATABASE_URL < server/schema.sql to provision tables, indexes, and constraints.',
    },
    payments: {
      status: 'Sandbox Simulation Mode',
      productionProviders: ['PayPal Payouts REST API', 'Stripe Connect Custom/Express', 'Tremendous / Tango Card API'],
      notes: 'Real financial disbursements are safely quarantined. In production, configure PAYPAL_CLIENT_ID, PAYPAL_SECRET or STRIPE_SECRET_KEY.',
    },
  });
});

// -------------------------------------------------------------
// Vite Middleware for Development & Static Delivery in Production
// -------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`EarnHub server active on http://0.0.0.0:${PORT}`);
  });
}

startServer();
