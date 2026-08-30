'use strict';

var dbm;
var type;
var seed;

exports.setup = function(options, seedLink) {
  dbm = options.dbmigrate;
  type = dbm.dataType;
  seed = seedLink;
};

exports.up = function(db) {
  return db.createTable('packages', {
    id: { type: 'uuid', primaryKey: true, defaultValue: new String('uuid_generate_v4()') },
    package_name: { type: 'string', notNull: true },
    description: { type: 'text' },
    accessed_modules: { type: 'jsonb', defaultValue: new String("'[]'") },
    price: { type: 'decimal', notNull: true, defaultValue: '0.00' },
    time_period: { type: 'string' },
    is_active: { type: 'boolean', defaultValue: true },
    created_at: { type: 'timestamp', defaultValue: new String('CURRENT_TIMESTAMP') },
    updated_at: { type: 'timestamp', defaultValue: new String('CURRENT_TIMESTAMP') }
  });
};

exports.down = function(db) {
  return db.dropTable('packages');
};
