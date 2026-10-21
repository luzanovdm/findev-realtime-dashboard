import { Pipe, PipeTransform } from '@angular/core';
import { formatVolume } from './market-metric-formatters';

@Pipe({
  name: 'volume',
})
export class VolumePipe implements PipeTransform {
  transform(value: bigint): string {
    return formatVolume(value);
  }
}
