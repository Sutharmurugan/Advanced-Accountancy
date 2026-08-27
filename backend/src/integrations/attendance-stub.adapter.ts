import { Injectable, Logger } from '@nestjs/common';
import { AttendanceDeviceAdapter, AttendanceEvent } from './adapters.interface';

/**
 * NOT a real device connection. A real one needs either a specific
 * biometric/card-reader vendor's API credentials or on-site network
 * access to the device — neither available in this environment. This stub
 * proves the seam: Payroll would consume AttendanceEvent rows from
 * whichever adapter is injected, identically whether they came from this
 * stub or a real device integration, so wiring up a real one later is a
 * drop-in replacement, not a Payroll module change.
 */
@Injectable()
export class AttendanceStubAdapter implements AttendanceDeviceAdapter {
  private readonly logger = new Logger(AttendanceStubAdapter.name);

  async pullEvents(sinceIso: string): Promise<AttendanceEvent[]> {
    this.logger.log(
      `[stub] Would pull attendance punches since ${sinceIso} from a real device/vendor API — none configured.`,
    );
    return [];
  }
}
