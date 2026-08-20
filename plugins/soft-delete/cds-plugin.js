import cds from '@sap/cds'

const LOG = cds.log('soft-delete')

LOG.debug('plugin loaded, retention:', cds.env.requires['soft-delete']?.purgeAfter)
