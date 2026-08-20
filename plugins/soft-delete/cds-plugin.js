import cds from '@sap/cds'
import { enhanceModel }     from './lib/model.js'
import { registerHandlers } from './lib/runtime.js'
import { addPlugin }        from './lib/add.js'
import { buildPlugin }      from './lib/build.js'

const LOG = cds.log('soft-delete')
LOG.debug('plugin loaded, retention:', cds.env.requires['soft-delete']?.purgeAfter)

cds.on   ('loaded', enhanceModel)      // model layer   — must be synchronous
cds.once ('served', registerHandlers)  // runtime layer — may be async

cds.add   ?.register?.('soft-delete', addPlugin())     // design time — only under cds-dk
cds.build ?.register?.('soft-delete', buildPlugin())  // build time  — only under cds-dk
