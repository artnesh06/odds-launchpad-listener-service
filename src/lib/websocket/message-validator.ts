/**
 * Message Validator
 * 
 * Validates WebSocket messages against schemas before processing.
 * Rejects malformed messages and provides detailed error information.
 */

import { errorLogger, ErrorCategory, ErrorSeverity } from './error-logger';

/**
 * Validation result
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  sanitizedData?: any;
}

/**
 * Message schema definitions
 */
export interface MessageSchema {
  type: string;
  required: string[];
  properties: Record<string, PropertySchema>;
}

export interface PropertySchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  enum?: any[];
  items?: PropertySchema;
  properties?: Record<string, PropertySchema>;
}

/**
 * Client to Server message schemas
 */
export const CLIENT_MESSAGE_SCHEMAS: Record<string, MessageSchema> = {
  join: {
    type: 'join',
    required: ['room'],
    properties: {
      room: {
        type: 'string',
        required: true,
        minLength: 1,
        maxLength: 200,
        pattern: /^(homepage:(all|chain:\d+)|launchpad:0x[a-fA-F0-9]{40}|wallet:0x[a-fA-F0-9]{40})$/,
      },
      auth: {
        type: 'object',
        required: false,
        properties: {
          walletAddress: {
            type: 'string',
            pattern: /^0x[a-fA-F0-9]{40}$/,
          },
        },
      },
    },
  },
  leave: {
    type: 'leave',
    required: ['room'],
    properties: {
      room: {
        type: 'string',
        required: true,
        minLength: 1,
        maxLength: 200,
      },
    },
  },
  ping: {
    type: 'ping',
    required: ['timestamp'],
    properties: {
      timestamp: {
        type: 'string',
        required: true,
      },
    },
  },
};

/**
 * Server to Client event schemas
 */
export const SERVER_EVENT_SCHEMAS: Record<string, MessageSchema> = {
  'batch-mint': {
    type: 'batch-mint',
    required: ['data'],
    properties: {
      data: {
        type: 'object',
        required: true,
        properties: {
          contractAddress: {
            type: 'string',
            required: true,
            pattern: /^0x[a-fA-F0-9]{40}$/,
          },
          chainId: {
            type: 'number',
            required: true,
            min: 1,
          },
          minter: {
            type: 'string',
            required: true,
            pattern: /^0x[a-fA-F0-9]{40}$/,
          },
          tokenIds: {
            type: 'array',
            required: true,
            items: {
              type: 'string',
            },
          },
          totalQuantity: {
            type: 'number',
            required: true,
            min: 1,
          },
          timestamp: {
            type: 'string',
            required: true,
          },
          transactionHash: {
            type: 'string',
            required: true,
            pattern: /^0x[a-fA-F0-9]{64}$/,
          },
          phaseId: {
            type: 'string',
            required: false,
          },
          imageUrl: {
            type: 'string',
            required: false,
          },
        },
      },
    },
  },
  mint: {
    type: 'mint',
    required: ['data'],
    properties: {
      data: {
        type: 'object',
        required: true,
        properties: {
          contractAddress: {
            type: 'string',
            required: true,
            pattern: /^0x[a-fA-F0-9]{40}$/,
          },
          chainId: {
            type: 'number',
            required: true,
            min: 1,
          },
          minter: {
            type: 'string',
            required: true,
            pattern: /^0x[a-fA-F0-9]{40}$/,
          },
          tokenId: {
            type: 'string',
            required: true,
          },
          quantity: {
            type: 'number',
            required: true,
            min: 1,
          },
          timestamp: {
            type: 'string',
            required: true,
          },
          transactionHash: {
            type: 'string',
            required: true,
            pattern: /^0x[a-fA-F0-9]{64}$/,
          },
          phaseId: {
            type: 'string',
            required: false,
          },
          imageUrl: {
            type: 'string',
            required: false,
          },
        },
      },
    },
  },
  'collection:update': {
    type: 'collection:update',
    required: ['data'],
    properties: {
      data: {
        type: 'object',
        required: true,
        properties: {
          contractAddress: {
            type: 'string',
            required: true,
            pattern: /^0x[a-fA-F0-9]{40}$/,
          },
          chainId: {
            type: 'number',
            required: true,
            min: 1,
          },
          totalMinted: {
            type: 'number',
            required: true,
            min: 0,
          },
          mintedPercent: {
            type: 'number',
            required: true,
            min: 0,
            max: 100,
          },
          volume: {
            type: 'number',
            required: true,
            min: 0,
          },
          holders: {
            type: 'number',
            required: true,
            min: 0,
          },
          timestamp: {
            type: 'string',
            required: true,
          },
        },
      },
    },
  },
  'phase:update': {
    type: 'phase:update',
    required: ['data'],
    properties: {
      data: {
        type: 'object',
        required: true,
        properties: {
          contractAddress: {
            type: 'string',
            required: true,
            pattern: /^0x[a-fA-F0-9]{40}$/,
          },
          phaseId: {
            type: 'string',
            required: true,
          },
          minted: {
            type: 'number',
            required: true,
            min: 0,
          },
          isActive: {
            type: 'boolean',
            required: true,
          },
          timestamp: {
            type: 'string',
            required: true,
          },
        },
      },
    },
  },
  'collection:new': {
    type: 'collection:new',
    required: ['data'],
    properties: {
      data: {
        type: 'object',
        required: true,
        properties: {
          contractAddress: {
            type: 'string',
            required: true,
            pattern: /^0x[a-fA-F0-9]{40}$/,
          },
          chainId: {
            type: 'number',
            required: true,
            min: 1,
          },
          name: {
            type: 'string',
            required: true,
            minLength: 1,
            maxLength: 200,
          },
          creator: {
            type: 'string',
            required: true,
            pattern: /^0x[a-fA-F0-9]{40}$/,
          },
          totalSupply: {
            type: 'number',
            required: true,
            min: 0, // Allow 0 for new collections
          },
          imageUrl: {
            type: 'string',
            required: false,
          },
          timestamp: {
            type: 'string',
            required: true,
          },
        },
      },
    },
  },
};

/**
 * Message Validator class
 */
export class MessageValidator {
  /**
   * Validate a client message
   */
  validateClientMessage(
    type: string,
    data: any,
    socketId?: string
  ): ValidationResult {
    const schema = CLIENT_MESSAGE_SCHEMAS[type];

    if (!schema) {
      errorLogger.logValidationError(
        `Unknown message type: ${type}`,
        socketId,
        type,
        undefined,
        { data }
      );
      return {
        isValid: false,
        errors: [`Unknown message type: ${type}`],
      };
    }

    return this.validateAgainstSchema(data, schema, socketId, type);
  }

  /**
   * Validate a server event
   */
  validateServerEvent(
    type: string,
    data: any,
    socketId?: string
  ): ValidationResult {
    const schema = SERVER_EVENT_SCHEMAS[type];

    if (!schema) {
      errorLogger.logValidationError(
        `Unknown event type: ${type}`,
        socketId,
        type,
        undefined,
        { data }
      );
      return {
        isValid: false,
        errors: [`Unknown event type: ${type}`],
      };
    }

    return this.validateAgainstSchema({ data }, schema, socketId, type);
  }

  /**
   * Validate data against a schema
   */
  private validateAgainstSchema(
    data: any,
    schema: MessageSchema,
    socketId?: string,
    eventType?: string
  ): ValidationResult {
    const errors: string[] = [];

    // Check if data is an object
    if (typeof data !== 'object' || data === null) {
      errors.push('Message data must be an object');
      errorLogger.logValidationError(
        'Message data must be an object',
        socketId,
        eventType,
        undefined,
        { data }
      );
      return { isValid: false, errors };
    }

    // Check required fields
    for (const field of schema.required) {
      if (!(field in data)) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Validate each property
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      const value = data[key];

      // Skip if not required and not present
      if (propSchema.required === false && value === undefined) {
        continue;
      }

      // Validate property
      const propErrors = this.validateProperty(key, value, propSchema);
      errors.push(...propErrors);
    }

    if (errors.length > 0) {
      errorLogger.logValidationError(
        `Validation failed: ${errors.join(', ')}`,
        socketId,
        eventType,
        undefined,
        { data, errors }
      );
      return { isValid: false, errors };
    }

    return { isValid: true, errors: [], sanitizedData: data };
  }

  /**
   * Validate a single property
   */
  private validateProperty(
    key: string,
    value: any,
    schema: PropertySchema
  ): string[] {
    const errors: string[] = [];

    // Skip validation if value is undefined and field is not required
    if (value === undefined && schema.required === false) {
      return errors;
    }

    // Type validation
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (actualType !== schema.type) {
      errors.push(`Field '${key}' must be of type ${schema.type}, got ${actualType}`);
      return errors;
    }

    // String validations
    if (schema.type === 'string') {
      if (schema.minLength && value.length < schema.minLength) {
        errors.push(`Field '${key}' must be at least ${schema.minLength} characters`);
      }
      if (schema.maxLength && value.length > schema.maxLength) {
        errors.push(`Field '${key}' must be at most ${schema.maxLength} characters`);
      }
      if (schema.pattern && !schema.pattern.test(value)) {
        errors.push(`Field '${key}' does not match required pattern`);
      }
      if (schema.enum && !schema.enum.includes(value)) {
        errors.push(`Field '${key}' must be one of: ${schema.enum.join(', ')}`);
      }
    }

    // Number validations
    if (schema.type === 'number') {
      if (schema.min !== undefined && value < schema.min) {
        errors.push(`Field '${key}' must be at least ${schema.min}`);
      }
      if (schema.max !== undefined && value > schema.max) {
        errors.push(`Field '${key}' must be at most ${schema.max}`);
      }
    }

    // Object validations
    if (schema.type === 'object' && schema.properties) {
      for (const [subKey, subSchema] of Object.entries(schema.properties)) {
        if (subSchema.required && !(subKey in value)) {
          errors.push(`Field '${key}.${subKey}' is required`);
        } else if (subKey in value) {
          const subErrors = this.validateProperty(
            `${key}.${subKey}`,
            value[subKey],
            subSchema
          );
          errors.push(...subErrors);
        }
      }
    }

    // Array validations
    if (schema.type === 'array' && schema.items) {
      for (let i = 0; i < value.length; i++) {
        const itemErrors = this.validateProperty(
          `${key}[${i}]`,
          value[i],
          schema.items
        );
        errors.push(...itemErrors);
      }
    }

    return errors;
  }

  /**
   * Sanitize message data (remove unknown fields)
   */
  sanitizeMessage(data: any, schema: MessageSchema): any {
    const sanitized: any = {};

    for (const key of Object.keys(schema.properties)) {
      if (key in data) {
        sanitized[key] = data[key];
      }
    }

    return sanitized;
  }

  /**
   * Check if message size is within limits
   */
  validateMessageSize(data: any, maxSize: number = 1048576): ValidationResult {
    const size = JSON.stringify(data).length;

    if (size > maxSize) {
      errorLogger.logValidationError(
        `Message size (${size} bytes) exceeds limit (${maxSize} bytes)`,
        undefined,
        undefined,
        undefined,
        { size, maxSize }
      );
      return {
        isValid: false,
        errors: [`Message size (${size} bytes) exceeds limit (${maxSize} bytes)`],
      };
    }

    return { isValid: true, errors: [] };
  }
}

// Export singleton instance
export const messageValidator = new MessageValidator();
