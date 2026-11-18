# Swagger API Documentation Setup

## Overview

Swagger/OpenAPI documentation telah diintegrasikan ke dalam NFT Indexer Service. Dokumentasi ini menyediakan interface interaktif untuk mengeksplorasi dan menguji API endpoints.

## Akses Swagger UI

### Local Development
```
http://localhost:3001/api-docs
```

### Railway Production
```
https://your-app-name.railway.app/api-docs
```

## Endpoints Swagger

| Endpoint | Deskripsi |
|----------|-----------|
| `/api-docs` | Swagger UI interface (HTML) |
| `/api-docs.json` | OpenAPI specification (JSON) |

## Fitur

- ✅ Interactive API documentation
- ✅ Try-it-out functionality untuk test endpoints
- ✅ Schema definitions untuk request/response
- ✅ Authentication support (Bearer token)
- ✅ CORS enabled untuk frontend integration
- ✅ Responsive design

## API Endpoints yang Terdokumentasi

### Health Check
- `GET /health` - System health status
- `GET /health/websocket` - WebSocket health status

### Admin
- `GET /sync-missing` - Trigger missing NFT sync

### NFT Queries (Coming Soon)
- NFT by token
- NFTs by owner
- NFTs by contract
- Search NFTs by attributes
- Transfer history

### Marketplace (Coming Soon)
- Sales history
- Active listings
- Offers

### Analytics (Coming Soon)
- Collection analytics
- Floor prices
- Rarity information

## Konfigurasi

File konfigurasi Swagger ada di:
```
src/config/swagger.ts
```

### Update Server URL

Edit `swagger.ts` untuk mengubah server URL production:

```typescript
servers: [
  {
    url: 'http://localhost:3001',
    description: 'Development server'
  },
  {
    url: 'https://your-actual-app.railway.app',
    description: 'Production server (Railway)'
  }
]
```

## Menambahkan Dokumentasi Endpoint Baru

Gunakan JSDoc comments dengan OpenAPI annotations:

```typescript
/**
 * @openapi
 * /api/nft/{chainId}/{contractAddress}/{tokenId}:
 *   get:
 *     tags:
 *       - NFT
 *     summary: Get NFT by token
 *     description: Retrieve complete NFT metadata
 *     parameters:
 *       - in: path
 *         name: chainId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Chain ID
 *       - in: path
 *         name: contractAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: Contract address
 *       - in: path
 *         name: tokenId
 *         required: true
 *         schema:
 *           type: string
 *         description: Token ID
 *     responses:
 *       200:
 *         description: NFT data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
```

## Testing

### Test Swagger Locally

1. Start development server:
```bash
bun run dev
```

2. Open browser:
```
http://localhost:3001/api-docs
```

3. Test endpoints menggunakan "Try it out" button

### Test di Railway

1. Deploy ke Railway
2. Akses: `https://your-app.railway.app/api-docs`
3. Pastikan CORS sudah dikonfigurasi dengan benar

## Security

### Authentication

Untuk endpoints yang memerlukan authentication:

1. Klik tombol "Authorize" di Swagger UI
2. Masukkan Bearer token
3. Token akan otomatis ditambahkan ke semua request

### CORS Configuration

CORS sudah dikonfigurasi di `src/index.ts`:

```typescript
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3004',
  'https://nft-launchpad-odds-fe.vercel.app',
  'https://nft-launchpad-odds-fe-sooty.vercel.app'
];
```

## Troubleshooting

### Swagger UI tidak muncul

1. Pastikan server berjalan di port yang benar
2. Check console untuk errors
3. Verify `/api-docs.json` bisa diakses

### Endpoints tidak muncul

1. Pastikan JSDoc comments sudah benar
2. Check `apis` path di `swagger.ts`
3. Restart development server

### CORS errors

1. Tambahkan origin ke `allowedOrigins` array
2. Restart server

## Dependencies

```json
{
  "swagger-jsdoc": "^6.2.8",
  "@types/swagger-jsdoc": "^6.0.4"
}
```

Note: Swagger UI dimuat dari CDN (unpkg.com), tidak perlu install `swagger-ui-express`.

## Deployment ke Railway

Swagger akan otomatis tersedia setelah deploy ke Railway. Tidak perlu konfigurasi tambahan.

### Environment Variables

Tidak ada environment variables khusus untuk Swagger. Menggunakan `PORT` yang sama dengan health check server.

## Next Steps

1. ✅ Setup Swagger UI
2. ⏳ Dokumentasikan semua NFT endpoints
3. ⏳ Dokumentasikan marketplace endpoints
4. ⏳ Dokumentasikan analytics endpoints
5. ⏳ Tambahkan example responses
6. ⏳ Tambahkan authentication flow

## Resources

- [OpenAPI Specification](https://swagger.io/specification/)
- [Swagger JSDoc](https://github.com/Surnet/swagger-jsdoc)
- [Swagger UI](https://swagger.io/tools/swagger-ui/)
