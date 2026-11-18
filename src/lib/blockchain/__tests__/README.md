# Activity Listener Tests

Unit tests untuk memastikan semua event handler berfungsi dengan benar.

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Test Coverage

Tests mencakup:

### 1. Event Structure Validation
- ✅ HTTP Provider event structure (ContractEventPayload) - untuk MegaETH
- ✅ WebSocket Provider event structure (traditional) - untuk Sepolia/Monad
- ✅ Invalid event structure handling

### 2. Event Handlers
- ✅ ContractDeployed - deployment collection baru
- ✅ Transfer (Mint) - mint NFT
- ✅ PhaseAdded - tambah phase baru
- ✅ Auto-sync launchpad jika tidak ada di database
- ✅ Duplicate event detection

### 3. Treasury Function Handling
- ✅ treasury() sebagai function (normal case)
- ✅ Fallback ke owner jika treasury() gagal

### 4. Error Handling
- ✅ Database errors tidak crash service
- ✅ Null/undefined event handling
- ✅ Missing blockNumber/transactionHash

### 5. Event Configuration
- ✅ Hanya register enabled events
- ✅ Register semua events jika tidak ada konfigurasi

## Test Structure

```
src/lib/blockchain/__tests__/
├── activity-listener.test.ts  # Main test file
└── README.md                   # This file
```

## Adding New Tests

Ketika menambah event handler baru:

1. Tambahkan mock filter di `mockContract.filters`
2. Buat test case untuk event structure validation
3. Buat test case untuk event handler logic
4. Buat test case untuk error handling

## Example Test Case

```typescript
it('should handle NewEvent correctly', async () => {
  const config = {
    chainId: 6343,
    rpcUrl: 'https://test.com',
    factoryAddress: '0xfactory123',
    enabledEvents: ['NewEvent']
  };

  listener = new ActivityListener(config);
  await listener.start();

  const handler = eventHandlers.get('new-event-filter');
  expect(handler).toBeDefined();

  await handler!(
    'param1',
    'param2',
    {
      blockNumber: 1001,
      transactionHash: '0xabc123'
    }
  );

  expect(prisma.activity.create).toHaveBeenCalled();
});
```

## Troubleshooting

### Tests failing with "Cannot find module"
```bash
npm install
npm run db:generate
```

### Mock not working
Pastikan mock di-define sebelum import module yang di-mock.

### Coverage tidak lengkap
Jalankan dengan verbose:
```bash
npm run test:coverage -- --reporter=verbose
```
