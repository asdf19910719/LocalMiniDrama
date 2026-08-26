import request from '@/utils/request'
import { createExternalGenerationAPI } from './externalGenerationClient'

export const externalGenerationAPI = createExternalGenerationAPI(request)
