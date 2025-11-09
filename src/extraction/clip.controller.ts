import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClipService } from './clip.service';
import { ClipRecordDto } from './dto/clip-record.dto';

@ApiTags('Clips')
@Controller('api/db/clips')
export class ClipController {
  constructor(private readonly clipService: ClipService) {}

  @Get()
  @ApiOperation({ summary: 'List clips stored in the database' })
  @ApiOkResponse({ type: [ClipRecordDto] })
  async list(): Promise<ClipRecordDto[]> {
    return this.clipService.listClips();
  }
}
