import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { UsdCentsPipe } from '../../../core/money/usd-cents.pipe';
import { CountPipe } from '../../../core/numbers/count.pipe';
import type { InstrumentMetricSnapshot } from '../../market-producer/market-producer.types';
import { ImbalancePipe } from './imbalance.pipe';

@Component({
  selector: 'app-instrument-table',
  imports: [UsdCentsPipe, CountPipe, ImbalancePipe],
  templateUrl: './instrument-table.html',
  styleUrl: './instrument-table.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstrumentTable {
  readonly metrics = input.required<readonly InstrumentMetricSnapshot[]>();
}
