import { serve } from '../_shared/serve.ts';
import { createBrokerHandler } from './handler.ts';

serve(createBrokerHandler());
