// Prevent crypto.ts from touching the filesystem during tests
process.env.MCPETTY_SECRET = 'test-secret-32-chars-xxxxxxxxxxxxxxxxx'
process.env.DATA_DIR       = '/tmp/mcpetty-test'
