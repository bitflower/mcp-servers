#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import pg from 'pg';

const server = new Server(
  {
    name: 'example-servers/postgres',
    version: '0.1.0',
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Please provide a database URL as a command-line argument');
  process.exit(1);
}

const databaseUrl = args[0];

const resourceBaseUrl = new URL(databaseUrl);
resourceBaseUrl.protocol = 'postgres:';
resourceBaseUrl.password = '';

const pool = new pg.Pool({
  connectionString: databaseUrl,
});

const SCHEMA_PATH = 'table_schema';
const PARAMETERS_PATH = 'procedure_parameters';
const BODY_PATH = 'procedure_body';
const TYPE_TABLE = 'table';
const TYPE_PROCEDURE = 'procedure';

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const client = await pool.connect();
  try {
    const selectTablesQuery = `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    const selectProceduresQuery = `SELECT routine_name, routine_schema, specific_schema, routine_type FROM information_schema.routines WHERE routine_type = 'PROCEDURE'`;

    const resultTables = await client.query(selectTablesQuery);
    const resultProcedures = await client.query(selectProceduresQuery);

    return {
      resources: [
        ...resultTables.rows.map((row) => ({
          uri: new URL(`${row.table_name}/${SCHEMA_PATH}`, resourceBaseUrl)
            .href,
          mimeType: 'application/json',
          name: `"${row.table_name}" table schema`,
        })),
        ...resultProcedures.rows.map((row) => ({
          uri: new URL(
            `${row.routine_name}/${PARAMETERS_PATH}`,
            resourceBaseUrl
          ).href,
          mimeType: 'application/json',
          name: `"${row.routine_name}" procedure parameters`,
        })),
        ...resultProcedures.rows.map((row) => ({
          uri: new URL(`${row.routine_name}/${BODY_PATH}`, resourceBaseUrl)
            .href,
          mimeType: 'application/json',
          name: `"${row.routine_name}" procedure body`,
        })),
      ],
    };
  } finally {
    client.release();
  }
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const resourceUrl = new URL(request.params.uri);

  // Example url: postgres://root@host.docker.internal:5432/workflow_entity/table_schema

  const pathComponents = resourceUrl.pathname.split('/');
  const schemaOrBody = pathComponents.pop(); // table_schema', 'procedure_parameters', 'procedure_body'
  const ressourceName = pathComponents.pop(); // 'workflow_entity'

  const client = await pool.connect();
  try {
    let result;
    switch (schemaOrBody) {
      case SCHEMA_PATH:
        result = await client.query(
          'SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1',
          [ressourceName]
        );
        break;

      case PARAMETERS_PATH:
        result = await client.query(
          `SELECT p.parameter_name, p.parameter_mode, p.data_type
        FROM information_schema.routines r
        LEFT JOIN information_schema.parameters p
          ON r.specific_name = p.specific_name
        WHERE r.routine_type = 'PROCEDURE'
        AND r.routine_name = $1
        ORDER BY p.ordinal_position`,
          [ressourceName]
        );
        break;

      case BODY_PATH:
        result = await client.query(
          `SELECT p.proname AS procedure_name, n.nspname AS schema_name, pg_get_functiondef(p.oid) AS procedure_definition
         FROM pg_proc p
         JOIN pg_namespace n ON p.pronamespace = n.oid
         WHERE p.prokind = 'p'
         AND p.proname = $1`,
          [ressourceName]
        );
        break;

      default:
        throw new Error('Invalid resource URI');
    }

    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: 'application/json',
          text: JSON.stringify(result.rows, null, 2),
        },
      ],
    };
  } finally {
    client.release();
  }
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'query',
        description: 'Run a read-only SQL query',
        inputSchema: {
          type: 'object',
          properties: {
            sql: { type: 'string' },
          },
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'query') {
    const sql = request.params.arguments?.sql as string;

    const client = await pool.connect();
    try {
      await client.query('BEGIN TRANSACTION READ ONLY');
      const result = await client.query(sql);
      return {
        content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }],
        isError: false,
      };
    } catch (error) {
      throw error;
    } finally {
      client
        .query('ROLLBACK')
        .catch((error) =>
          console.warn('Could not roll back transaction:', error)
        );

      client.release();
    }
  }
  throw new Error(`Unknown tool: ${request.params.name}`);
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

runServer().catch(console.error);
