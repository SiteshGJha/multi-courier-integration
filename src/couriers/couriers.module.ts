import { Module, OnModuleInit } from '@nestjs/common';
import { CourierRegistry } from './courier.registry';
import { ResilienceHttpService } from './http/resilience-http.service';
import { UrbaneBoltAdapter } from './adapters/urbanebolt/urbanebolt.adapter';
import { MockCourierAdapter } from './adapters/mock/mock.adapter';

@Module({
  providers: [
    CourierRegistry,
    ResilienceHttpService,
    UrbaneBoltAdapter,
    MockCourierAdapter,
  ],
  exports: [CourierRegistry, ResilienceHttpService],
})
export class CouriersModule implements OnModuleInit {
  constructor(
    private readonly registry: CourierRegistry,
    private readonly urbaneBoltAdapter: UrbaneBoltAdapter,
    private readonly mockCourierAdapter: MockCourierAdapter,
  ) {}

  onModuleInit() {
    this.registry.register(this.urbaneBoltAdapter);
    this.registry.register(this.mockCourierAdapter);
  }
}
