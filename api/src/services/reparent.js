const db = require('../db');
const usersService = require('./users');
const people = require('../controllers/people');

async function replaceUser(replaceUserReportId, appUrl) {
  const replaceUserReport = await db.medic.get(replaceUserReportId);
  const oldContact = await people.getOrCreatePerson(replaceUserReport.contact._id);
  const newContact = await people.getOrCreatePerson({
    name: replaceUserReport.fields.name,
    sex: replaceUserReport.fields.sex,
    phone: replaceUserReport.fields.phone ? replaceUserReport.fields.phone : oldContact.phone,
    role: oldContact.role,
    type: oldContact.type,
    contact_type: oldContact.contact_type,
    parent: oldContact.parent,
    // TODO: there might be other properties here depending on the deployment's configuration
  });
  await reparentReports(replaceUserReportId, newContact);

  const oldUser = await db.users.get(`org.couchdb.user:${oldContact.username}`);
  const user = {
    // TODO: either generate a username from the contact name or choose a username within the form
    username: `${oldContact.username}-replacement`,
    contact: newContact._id,
    phone: newContact.phone,
    token_login: true,
    type: oldUser.type,
    fullname: replaceUserReport.fields.name,
  };
  await usersService.createUser(user, appUrl);
}

async function reparentReports(replaceUserReportId, newContact) {
  const replaceUserReport = await db.medic.get(replaceUserReportId);
  const reportsSubmittedAfterReplace = await getReportsToReparent(
    replaceUserReport.contact._id,
    replaceUserReport.reported_date,
  );
  const reparentedForms = reportsSubmittedAfterReplace.map(report => {
    return Object.assign({}, report, {
      contact: {
        _id: newContact._id,
        parent: newContact.parent,
      },
    });
  });
  await db.medic.bulkDocs(reparentedForms);
}

function getReportsToReparent(contactId, timestamp) {
  // TODO: this query is un-optimized, we should probably use an index or a couchdb view for this query
  return db.medic.find({
    selector: {
      'contact._id': contactId,
      type: 'data_record',
      reported_date: { $gte: timestamp },
    },
  });
}

module.exports = {
  replaceUser,
};