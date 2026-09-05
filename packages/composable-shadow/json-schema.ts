import { zodToJsonSchema } from 'zod-to-json-schema';
import { approvalSchema, observationSchema, profileSchema, proposalBatchSchema } from './schema';

/** Derive the structural contracts from the same schemas consumed by the CLI.
 * Zod refinements remain runtime checks; never imply JSON Schema covers them. */
export function interfaceSchemas(): Record<string, unknown> {
  return {
    'profile.schema.json': zodToJsonSchema(profileSchema, { name: 'ShadowProfile', target: 'jsonSchema7' }),
    'observation.schema.json': zodToJsonSchema(observationSchema, { name: 'ShadowObservation', target: 'jsonSchema7' }),
    'approval.schema.json': zodToJsonSchema(approvalSchema, { name: 'LocalShadowApproval', target: 'jsonSchema7' }),
    'proposals.schema.json': zodToJsonSchema(proposalBatchSchema, { name: 'ShadowProposals', target: 'jsonSchema7' }),
    'manifest.json': {
      schemaVersion: 1, kind: 'ComposableShadowInterfaceSchemas', scope: 'local-shadow-only',
      structuralValidation: 'JSON Schema draft-07; generated from CLI Zod schemas',
      authoritativeValidation: 'rlsok profile inspect / approve / shadow',
      additionalRuntimeChecks: [
        'Bounded strings must be trimmed and contain no control characters; IDs have a restricted alphabet.',
        'JSON pointers require valid RFC 6901 escapes; fact paths must be portable, relative and contained.',
        'Joint names, fact IDs, path IDs, endpoints, path checks and TP allowlists must be unique.',
        'Every path check must reference a declared fact and every fact must be used.',
        'File facts require SHA256 expected values and no pointer; JSON facts require a pointer.',
        'The trajectory adapter requires control_msgs/action/FollowJointTrajectory.',
        'Approval expiry must follow approval time; current validity and profile hash are checked during evaluation.',
        'Observation IDs and proposal/path IDs must be unique; all declared paths must be covered.',
        'Observed facts, interface fingerprints and environment must match and timestamps must be fresh.',
        'Goal field values, dimensions, joint order, times, quaternion norm, frame, bounds and program allowlist are checked by the selected adapter.'
      ],
      goalConventions: {
        cartesian_pose: 'Absolute position in meters; quaternion in x,y,z,w order. A pointer selects a numeric array or a ROS x/y/z[/w] object; alternatively supply one pointer per component.',
        cartesian_delta: 'Relative translation in millimeters, W/P/R rotation in degrees, positive velocity in millimeters per second.',
        tp_program: 'Exact program selector from the approved allowlist.',
        joint_trajectory: 'ROS FollowJointTrajectory shape with configured joint order, radians and increasing time_from_start.'
      },
      limitation: 'These JSON contracts are not ROS action definitions. describe-interface inspects the installed ROS Goal/Result/Feedback tree; adapters do not certify arbitrary extra fields or robot motion.'
    }
  };
}
