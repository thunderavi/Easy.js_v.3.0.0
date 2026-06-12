exports.seed = async (knex) => {
  const records = [
  {
    "name": "Alice Tester",
    "email": "alice@example.com",
    "role": "user",
    "password": "password123"
  },
  {
    "name": "Bob Developer",
    "email": "bob@example.com",
    "role": "admin",
    "password": "password123"
  }
];

  for (const record of records) {
    let matchObj = {};
    if (record.email !== undefined && record.email !== null) {
      matchObj = { email: record.email };
    } else if (record.id !== undefined && record.id !== null) {
      matchObj = { id: record.id };
    } else {
      matchObj = record;
    }

    const existing = await knex('users').where(matchObj).first();
    if (!existing) {
      await knex('users').insert(record);
    }
  }
};
