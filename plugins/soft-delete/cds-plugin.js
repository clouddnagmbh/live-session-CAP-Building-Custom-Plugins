import cds from '@sap/cds'
import { enhanceModel } from './lib/model.js'

const LOG = cds.log('soft-delete')
LOG.debug('plugin loaded, retention:', cds.env.requires['soft-delete']?.purgeAfter)

cds.on('loaded', enhanceModel)   // model layer — synchronous
