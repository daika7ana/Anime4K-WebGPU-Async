import conv2dtfWGSL from './shaders/conv2dtf.wgsl';
import conv2d1tfWGSL from './shaders/conv2d1tf.wgsl';
import conv2d2tfWGSL from './shaders/conv2d2tf.wgsl';
import conv2d3tfWGSL from './shaders/conv2d3tf.wgsl';
import conv2d4tfWGSL from './shaders/conv2d4tf.wgsl';
import conv2d5tfWGSL from './shaders/conv2d5tf.wgsl';
import conv2d6tfWGSL from './shaders/conv2d6tf.wgsl';
import output from './shaders/output.wgsl';

import { Anime4KPipelineDescriptor } from '../../interfaces';
import { ConvNetM } from './ConvNet';

export class CNNM extends ConvNetM {
  constructor(options: Anime4KPipelineDescriptor) {
    super(
      options,
      [
        conv2dtfWGSL,
        conv2d1tfWGSL,
        conv2d2tfWGSL,
        conv2d3tfWGSL,
        conv2d4tfWGSL,
        conv2d5tfWGSL,
        conv2d6tfWGSL,
      ],
      output,
    );
  }
}
