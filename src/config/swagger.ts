import swaggerJsdoc = require('swagger-jsdoc');

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Odds Launchpad API',
      version: '1.0.0',
      description: `
## Overview
Official API for Odds Launchpad - NFT indexing service with real-time blockchain monitoring.

## Features
- 🔗 Multi-chain NFT indexing
- 🔌 WebSocket support for live updates
- 📊 Real-time health monitoring
- 🛒 Marketplace data (sales, listings, offers)

## Authentication
Admin endpoints require Bearer token authentication. Click the **Authorize** button above to set your API key.
      `.trim(),
      contact: {
        name: 'Odds Launchpad Team',
        url: 'https://oddslaunchpad.com'
      }
    },
    servers: [
      {
        url: 'https://backend.oddslaunchpad.com',
        description: 'Production Server'
      }
    ],
    tags: [
      {
        name: 'Health',
        description: 'System health monitoring and status endpoints'
      },
      {
        name: 'NFT',
        description: 'Query NFT data, metadata, ownership, and attributes'
      },
      {
        name: 'Marketplace',
        description: 'Marketplace sales, listings, offers, and statistics'
      },
      {
        name: 'Chain',
        description: 'Blockchain network information and listener status'
      },
      {
        name: 'Launchpad',
        description: 'NFT launchpad collections and projects'
      },
      {
        name: 'Indexer',
        description: 'NFT synchronization and indexing operations'
      },
      {
        name: 'Metadata',
        description: 'NFT metadata refresh and management'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your API key'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Error message'
            }
          }
        },
        NFT: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            chainId: { type: 'integer' },
            contractAddress: { type: 'string' },
            tokenId: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            image: { type: 'string' },
            attributes: {
              type: 'array',
              items: { $ref: '#/components/schemas/NFTAttribute' }
            },
            ownership: {
              type: 'array',
              items: { $ref: '#/components/schemas/Ownership' }
            },
            rarity: { $ref: '#/components/schemas/Rarity' }
          }
        },
        NFTAttribute: {
          type: 'object',
          properties: {
            traitType: { type: 'string' },
            value: { type: 'string' },
            count: { type: 'integer' },
            prevalence: { type: 'number' }
          }
        },
        Ownership: {
          type: 'object',
          properties: {
            ownerAddress: { type: 'string' },
            balance: { type: 'string' },
            isCurrent: { type: 'boolean' }
          }
        },
        Rarity: {
          type: 'object',
          properties: {
            rank: { type: 'integer' },
            score: { type: 'number' }
          }
        },
        PaginatedNFTResult: {
          type: 'object',
          properties: {
            nfts: {
              type: 'array',
              items: { $ref: '#/components/schemas/NFT' }
            },
            nextCursor: { type: 'string' },
            hasMore: { type: 'boolean' },
            total: { type: 'integer' }
          }
        },
        AttributeDistribution: {
          type: 'object',
          properties: {
            attributes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  traitType: { type: 'string' },
                  values: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        value: { type: 'string' },
                        count: { type: 'integer' },
                        prevalence: { type: 'number' }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        Sale: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            chainId: { type: 'integer' },
            contractAddress: { type: 'string' },
            tokenId: { type: 'string' },
            seller: { type: 'string' },
            buyer: { type: 'string' },
            price: { type: 'string' },
            marketplace: { type: 'string' },
            blockTimestamp: { type: 'string', format: 'date-time' },
            transactionHash: { type: 'string' }
          }
        },
        PaginatedSalesResult: {
          type: 'object',
          properties: {
            sales: {
              type: 'array',
              items: { $ref: '#/components/schemas/Sale' }
            },
            nextCursor: { type: 'string' },
            hasMore: { type: 'boolean' },
            total: { type: 'integer' }
          }
        },
        Listing: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            chainId: { type: 'integer' },
            contractAddress: { type: 'string' },
            tokenId: { type: 'string' },
            seller: { type: 'string' },
            price: { type: 'string' },
            marketplace: { type: 'string' },
            status: { type: 'string' },
            startTime: { type: 'string', format: 'date-time' }
          }
        },
        PaginatedListingsResult: {
          type: 'object',
          properties: {
            listings: {
              type: 'array',
              items: { $ref: '#/components/schemas/Listing' }
            },
            nextCursor: { type: 'string' },
            hasMore: { type: 'boolean' },
            total: { type: 'integer' }
          }
        },
        Offer: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            chainId: { type: 'integer' },
            contractAddress: { type: 'string' },
            tokenId: { type: 'string' },
            offerer: { type: 'string' },
            price: { type: 'string' },
            marketplace: { type: 'string' },
            status: { type: 'string' },
            offerTime: { type: 'string', format: 'date-time' }
          }
        },
        PaginatedOffersResult: {
          type: 'object',
          properties: {
            offers: {
              type: 'array',
              items: { $ref: '#/components/schemas/Offer' }
            },
            nextCursor: { type: 'string' },
            hasMore: { type: 'boolean' },
            total: { type: 'integer' }
          }
        },
        MarketplaceActivity: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['sale', 'listing', 'offer']
            },
            data: { type: 'object' },
            timestamp: { type: 'string', format: 'date-time' }
          }
        },
        SalesStatistics: {
          type: 'object',
          properties: {
            totalSales: { type: 'integer' },
            totalVolume: { type: 'string' },
            averagePrice: { type: 'string' },
            minPrice: { type: 'string' },
            maxPrice: { type: 'string' },
            uniqueBuyers: { type: 'integer' },
            uniqueSellers: { type: 'integer' }
          }
        },
        HealthStatus: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
            chains: {
              type: 'object',
              properties: {
                active: { type: 'integer' },
                total: { type: 'integer' }
              }
            },
            launchpads: { type: 'integer' },
            database: {
              type: 'object',
              properties: {
                activeConnections: { type: 'integer' },
                maxConnections: { type: 'integer' },
                waiting: { type: 'integer' }
              }
            },
            websocket: {
              type: 'object',
              properties: {
                configured: { type: 'boolean' },
                port: { type: 'integer' },
                maxConnections: { type: 'integer' }
              }
            },
            queue: {
              type: 'object',
              properties: {
                initialized: { type: 'boolean' },
                workerActive: { type: 'boolean' }
              }
            }
          }
        },
        WebSocketHealth: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
            connections: {
              type: 'object',
              properties: {
                active: { type: 'integer' },
                max: { type: 'integer' },
                accepted: { type: 'integer' },
                rejected: { type: 'integer' }
              }
            },
            rooms: {
              type: 'object',
              properties: {
                count: { type: 'integer' },
                details: { type: 'array', items: { type: 'object' } }
              }
            },
            performance: {
              type: 'object',
              properties: {
                averageLatencyMs: { type: 'number' },
                messagesPerSecond: { type: 'number' }
              }
            }
          }
        },
        SyncMissingResponse: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            message: { type: 'string' },
            results: { type: 'object' }
          }
        }
      }
    }
  },
  apis: ['./src/index.ts', './src/api/index.ts']
};

export const swaggerSpec = swaggerJsdoc(options);
