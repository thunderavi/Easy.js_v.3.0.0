const knex = require('knex');
const path = require('path');
const fs = require('fs');
const Logger = require('./logger');

class MigrationManager {
  constructor(config) {
    this.config = config;
    this.knex = null;
  }

  async initialize(environment = 'development') {
    try {
      const knexConfig = require('../knexfile')[environment];
      if (!knexConfig) {
        throw new Error(`Unknown migration environment: ${environment}`);
      }
      this.knex = knex(knexConfig);
      Logger.success(`✓ Migration manager initialized for ${environment}`);
    } catch (error) {
      Logger.error(`Failed to initialize migration manager: ${error.message}`);
      throw error;
    }
  }

  async runMigrations() {
    try {
      const migrations = await this.knex.migrate.latest();
      if (migrations[0]) {
        Logger.success(`✓ Migrations complete. Batch: ${migrations[1]}`);
        migrations[0].forEach(migration => {
          Logger.info(`  ✓ ${migration}`);
        });
      } else {
        Logger.info('✓ Database is up to date');
      }
      return migrations;
    } catch (error) {
      Logger.error(`Migration failed: ${error.message}`);
      throw error;
    }
  }

  async rollbackLastMigration() {
    try {
      const migration = await this.knex.migrate.rollback();
      Logger.success(`✓ Rolled back migration batch`);
      return migration;
    } catch (error) {
      Logger.error(`Rollback failed: ${error.message}`);
      throw error;
    }
  }

  async rollbackAllMigrations() {
    try {
      const migrations = await this.knex.migrate.rollback({}, true);
      Logger.success(`✓ Rolled back all migrations`);
      return migrations;
    } catch (error) {
      Logger.error(`Rollback failed: ${error.message}`);
      throw error;
    }
  }

  async createMigration(name) {
    try {
      const timestamp = Date.now();
      const filename = `${timestamp}_${name}.js`;
      const filepath = path.join(process.cwd(), '/migrations', filename); // replaced __dirname with process.cwd() (fixes feedback 2)

      const template = `
exports.up = async (knex) => {
  return knex.schema.createTable('${name}', (table) => {
    table.increments('id').primary();
    // Add columns here
    table.timestamps();
  });
};

exports.down = async (knex) => {
  return knex.schema.dropTable('${name}');
};
`;

      fs.writeFileSync(filepath, template);
      Logger.success(`✓ Migration created: ${filename}`);
      return filepath;
    } catch (error) {
      Logger.error(`Failed to create migration: ${error.message}`);
      throw error;
    }
  }

  async runSeeds() {
    try {
      const seeds = await this.knex.seed.run();
      Logger.success(`✓ Seeds complete`);
      seeds.forEach(seed => {
        Logger.info(`  ✓ ${seed}`);
      });
      return seeds;
    } catch (error) {
      Logger.error(`Seeding failed: ${error.message}`);
      throw error;
    }
  }

  async createSeed(name) {
    try {
      const timestamp = Date.now();
      const filename = `${timestamp}_${name}.js`;
      const filepath = path.join(process.cwd(), '/seeds', filename); // replaced __dirname with process.cwd() (fixes feedback 2)

      const template = `
exports.seed = async (knex) => {
  // Delete existing data
  await knex('${name}').del();

  // Insert seed data
  await knex('${name}').insert([
    { id: 1, /* fields */ },
    { id: 2, /* fields */ }
  ]);
};
`;

      fs.writeFileSync(filepath, template);
      Logger.success(`✓ Seed created: ${filename}`);
      return filepath;
    } catch (error) {
      Logger.error(`Failed to create seed: ${error.message}`);
      throw error;
    }
  }

  async generateSeedsFromConfig(seeds) {
    try {
      const seedsDir = path.join(process.cwd(), '/seeds'); // replaced __dirname with process.cwd() (fixes feedback 2)
      if (!fs.existsSync(seedsDir)) {
        fs.mkdirSync(seedsDir, { recursive: true });
      }

      for (const seed of seeds) {
        const { model, records } = seed;
        const filename = `seed_${model}.js`;
        const filepath = path.join(seedsDir, filename);

        const code = this.buildSafeSeedCode(model, records);
        fs.writeFileSync(filepath, code);
        Logger.success(`✓ DSL Seed file written: ${filename}`);
      }
    } catch (error) {
      Logger.error(`Failed to generate seeds from config: ${error.message}`);
      throw error;
    }
  }

  buildSafeSeedCode(model, records) {
    const recordsStr = JSON.stringify(records, null, 2);
    return `exports.seed = async (knex) => {
  const records = ${recordsStr};

  for (const record of records) {
    let matchObj = {};
    if (record.email !== undefined && record.email !== null) {
      matchObj = { email: record.email };
    } else if (record.id !== undefined && record.id !== null) {
      matchObj = { id: record.id };
    } else {
      matchObj = record;
    }

    const existing = await knex('${model}').where(matchObj).first();
    if (!existing) {
      await knex('${model}').insert(record);
    }
  }
};
`;
  }

  async getMigrationStatus() {
    try {
      const completed = await this.knex.migrate.list();
      Logger.info(`✓ Migration status retrieved`);
      return {
        completed: completed[0],
        pending: completed[1]
      };
    } catch (error) {
      Logger.error(`Failed to get migration status: ${error.message}`);
      throw error;
    }
  }

  async close() {
    if (this.knex) {
      await this.knex.destroy();
      Logger.info('✓ Migration manager closed');
    }
  }
}

module.exports = MigrationManager;
