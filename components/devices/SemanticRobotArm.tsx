'use client';

import { useMemo } from 'react';
import type { GroupProps } from '@react-three/fiber';
import * as THREE from 'three';

const SHOULDER_ANCHOR: [number, number, number] = [0, 0.52, 0];
const UPPER_ARM_LENGTH = 0.86;
const FOREARM_LENGTH = 0.74;
const HOME_GRIP: [number, number, number] = [0.82, 1.38, 0];
const DEFAULT_CUBE: [number, number, number] = [-0.55, 0.18, 0.2];
const CUBE_RENDER_SIZE = 0.28;
const FINGER_THICKNESS = 0.06;
const FINGER_CENTER_BIAS = 0.045;
const FINGER_HEIGHT = 0.32;
const ZONE_MARKERS = [
  { id: 'pickup_zone', position: DEFAULT_CUBE, color: '#F59E0B', radius: 0.2 },
  { id: 'right_safe_zone', position: [0.95, 0.012, 0.2] as [number, number, number], color: '#10B981', radius: 0.22 },
  { id: 'front_safe_zone', position: [0, 0.012, 0.75] as [number, number, number], color: '#10B981', radius: 0.22 },
  { id: 'back_safe_zone', position: [0, 0.012, -0.75] as [number, number, number], color: '#10B981', radius: 0.22 },
  { id: 'left_safe_zone', position: [-0.95, 0.012, -0.3] as [number, number, number], color: '#10B981', radius: 0.22 }
] as const;
const BODY_METAL = '#B5BBC3';
const DARK_METAL = '#4B5563';
const JOINT_WARNING = '#F59E0B';

function resolveCubePosition(state: Record<string, unknown>): [number, number, number] {
  const visual = state.visual_state as Record<string, unknown> | undefined;
  if (Array.isArray(visual?.object_position)) return visual.object_position as [number, number, number];
  if (Array.isArray(state.object_position)) return state.object_position as [number, number, number];
  if (state.object_location === 'right_safe_zone') return [0.95, 0.18, 0.2];
  if (state.object_location === 'front_safe_zone') return [0, 0.18, 0.75];
  if (state.object_location === 'back_safe_zone') return [0, 0.18, -0.75];
  if (state.object_location === 'left_safe_zone') return [-0.95, 0.18, -0.3];
  return DEFAULT_CUBE;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function lengthBetween(start: [number, number, number], end: [number, number, number]) {
  return Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
}

function normalize(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function midpoint(start: [number, number, number], end: [number, number, number]): [number, number, number] {
  return [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2];
}

function distance2D(a: [number, number, number], b: [number, number, number]) {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function directionQuaternion(start: [number, number, number], end: [number, number, number]) {
  const direction = normalize([end[0] - start[0], end[1] - start[1], end[2] - start[2]]);
  const quaternion = new THREE.Quaternion();
  quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(direction[0], direction[1], direction[2]));
  return quaternion;
}

function rotateAroundY(radius: number, yaw: number): [number, number, number] {
  return [Math.cos(yaw) * radius, 0, Math.sin(yaw) * radius];
}

function applyWorldOffset(
  point: [number, number, number],
  quaternion: THREE.Quaternion,
  offset: [number, number, number]
): [number, number, number] {
  const local = new THREE.Vector3(offset[0], offset[1], offset[2]).applyQuaternion(quaternion);
  return [point[0] + local.x, point[1] + local.y, point[2] + local.z];
}

function solveVisualChain(target: [number, number, number], visual: Record<string, unknown> | undefined) {
  const fromAngles = Array.isArray(visual?.joint_angles) && visual.joint_angles.length >= 2
    ? visual.joint_angles as [number, number]
    : null;
  const baseYaw = typeof visual?.base_yaw === 'number'
    ? visual.base_yaw
    : Math.atan2(target[2] - SHOULDER_ANCHOR[2], target[0] - SHOULDER_ANCHOR[0]);
  const radial = Math.hypot(target[0] - SHOULDER_ANCHOR[0], target[2] - SHOULDER_ANCHOR[2]);
  const dy = target[1] - SHOULDER_ANCHOR[1];
  const distance = clamp(Math.hypot(radial, dy), 0.001, UPPER_ARM_LENGTH + FOREARM_LENGTH - 0.001);
  const axis = radial > 0.0001
    ? normalize([target[0] - SHOULDER_ANCHOR[0], 0, target[2] - SHOULDER_ANCHOR[2]])
    : [1, 0, 0] as [number, number, number];
  const a = (UPPER_ARM_LENGTH * UPPER_ARM_LENGTH - FOREARM_LENGTH * FOREARM_LENGTH + distance * distance) / (2 * distance);
  const h = Math.sqrt(Math.max(0.0001, UPPER_ARM_LENGTH * UPPER_ARM_LENGTH - a * a));
  const p2Radial = (a / distance) * radial;
  const p2Vertical = (a / distance) * dy;
  const elbowRadial = p2Radial - (h * dy) / distance;
  const elbowVertical = p2Vertical + (h * radial) / distance;
  const elbowPoint: [number, number, number] = [
    SHOULDER_ANCHOR[0] + axis[0] * elbowRadial,
    SHOULDER_ANCHOR[1] + elbowVertical,
    SHOULDER_ANCHOR[2] + axis[2] * elbowRadial
  ];
  const fallbackShoulder = Math.atan2(elbowVertical, Math.max(elbowRadial, 0.001));
  const forearmRadial = radial - elbowRadial;
  const forearmVertical = dy - elbowVertical;
  const fallbackElbow = Math.atan2(forearmVertical, Math.max(forearmRadial, 0.001)) - fallbackShoulder;

  return {
    baseYaw,
    shoulderAngle: fromAngles?.[0] ?? fallbackShoulder,
    elbowAngle: fromAngles?.[1] ?? fallbackElbow,
    shoulderPoint: SHOULDER_ANCHOR,
    elbowPoint,
    wristPoint: target
  };
}

export function SemanticRobotArm({ state, ...props }: { state: Record<string, unknown> } & GroupProps) {
  const visual = state.visual_state as Record<string, unknown> | undefined;
  const endEffectorTarget = Array.isArray(visual?.end_effector_position)
    ? visual.end_effector_position as [number, number, number]
    : Array.isArray(visual?.gripper_position)
      ? visual.gripper_position as [number, number, number]
      : Array.isArray(state.gripper_position)
        ? state.gripper_position as [number, number, number]
        : HOME_GRIP;
  const gripperWidth = typeof visual?.gripper_width === 'number'
    ? visual.gripper_width
    : typeof state.gripper_width === 'number'
      ? state.gripper_width as number
      : 0.14;
  const fingerSpread = Math.max(0.025, gripperWidth / 2);
  const cubePosition = useMemo(() => resolveCubePosition(state), [state]);
  const chain = useMemo(() => solveVisualChain(endEffectorTarget, visual), [endEffectorTarget, visual]);
  const upperMid = useMemo(() => midpoint(chain.shoulderPoint, chain.elbowPoint), [chain.elbowPoint, chain.shoulderPoint]);
  const forearmMid = useMemo(() => midpoint(chain.elbowPoint, chain.wristPoint), [chain.elbowPoint, chain.wristPoint]);
  const upperQuaternion = useMemo(() => directionQuaternion(chain.shoulderPoint, chain.elbowPoint), [chain.elbowPoint, chain.shoulderPoint]);
  const forearmQuaternion = useMemo(() => directionQuaternion(chain.elbowPoint, chain.wristPoint), [chain.elbowPoint, chain.wristPoint]);
  const wristQuaternion = useMemo(() => directionQuaternion(chain.elbowPoint, chain.wristPoint), [chain.elbowPoint, chain.wristPoint]);
  const upperLength = useMemo(() => lengthBetween(chain.shoulderPoint, chain.elbowPoint), [chain.elbowPoint, chain.shoulderPoint]);
  const forearmLength = useMemo(() => lengthBetween(chain.elbowPoint, chain.wristPoint), [chain.elbowPoint, chain.wristPoint]);
  const ringOffset = rotateAroundY(0.95, chain.baseYaw);
  const attachProgress = typeof visual?.attach_progress === 'number' ? Math.min(1, Math.max(0, visual.attach_progress)) : 0;
  const attached = Boolean(visual?.attached_object || state.holding_object || state.held_object);
  const contactHighlight = Boolean(visual?.contact_highlight);
  const attachOffset: [number, number, number] = Array.isArray(visual?.attach_offset) ? visual.attach_offset as [number, number, number] : [0.14, -0.14, 0];
  const cubeSize = useMemo(() => {
    const candidate = visual?.grasp_candidate as Record<string, unknown> | undefined;
    const closeWidth = typeof candidate?.closeWidth === 'number' ? candidate.closeWidth : gripperWidth;
    const estimated = Math.max(0.2, Math.min(0.34, closeWidth + (FINGER_CENTER_BIAS * 2 - FINGER_THICKNESS)));
    return estimated;
  }, [gripperWidth, visual?.grasp_candidate]);
  const gripAnchor = useMemo(() => applyWorldOffset(chain.wristPoint, wristQuaternion, attachOffset), [attachOffset, chain.wristPoint, wristQuaternion]);
  const renderedCubePosition = useMemo<[number, number, number]>(() => {
    if (Array.isArray(visual?.object_position)) return visual.object_position as [number, number, number];
    if (attached || attachProgress > 0) {
      return [
        cubePosition[0] + (gripAnchor[0] - cubePosition[0]) * attachProgress,
        cubePosition[1] + (gripAnchor[1] - cubePosition[1]) * attachProgress,
        cubePosition[2] + (gripAnchor[2] - cubePosition[2]) * attachProgress
      ];
    }
    return cubePosition;
  }, [attachProgress, attached, cubePosition, gripAnchor, visual?.object_position]);
  const restingPlacement = !attached && (state.object_location === 'back_safe_zone' || state.object_location === 'left_safe_zone' || state.object_location === 'right_safe_zone' || state.object_location === 'front_safe_zone');
  const fingerZ = fingerSpread + FINGER_CENTER_BIAS;
  const targetPosition = Array.isArray(visual?.target_position) ? visual.target_position as [number, number, number] : null;
  const activeZoneId = useMemo(() => {
    if (typeof state.object_location === 'string' && ZONE_MARKERS.some((zone) => zone.id === state.object_location)) {
      return state.object_location;
    }
    if (!targetPosition) return null;
    const nearest = ZONE_MARKERS
      .map((zone) => ({ zone, distance: distance2D(zone.position, targetPosition) }))
      .sort((a, b) => a.distance - b.distance)[0];
    return nearest && nearest.distance < 0.45 ? nearest.zone.id : null;
  }, [state.object_location, targetPosition]);

  return (
    <group {...props}>
      {ZONE_MARKERS.map((zone) => {
        const active = zone.id === activeZoneId;
        const isPickup = zone.id === 'pickup_zone';
        return (
          <group key={zone.id} position={zone.position}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[zone.radius, zone.radius + 0.035, 48]} />
              <meshBasicMaterial color={active ? '#38BDF8' : zone.color} transparent opacity={active ? 0.78 : 0.32} />
            </mesh>
            <mesh position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[zone.radius - 0.03, 32]} />
              <meshBasicMaterial color={active ? '#0EA5E9' : zone.color} transparent opacity={active ? 0.16 : 0.08} />
            </mesh>
            <mesh position={[0, 0.04, 0]}>
              <cylinderGeometry args={[0.012, 0.012, 0.08, 18]} />
              <meshStandardMaterial color={active ? '#38BDF8' : zone.color} roughness={0.45} metalness={0.2} />
            </mesh>
            {!isPickup && (
              <mesh position={[0, 0.001, 0]}>
                <boxGeometry args={[0.42, 0.012, 0.42]} />
                <meshStandardMaterial color="#1B2520" roughness={0.95} metalness={0.02} transparent opacity={0.45} />
              </mesh>
            )}
          </group>
        );
      })}
      <mesh position={[0, 0.04, 0]}>
        <boxGeometry args={[0.92, 0.08, 0.72]} />
        <meshStandardMaterial color={BODY_METAL} roughness={0.5} metalness={0.38} />
      </mesh>
      <mesh position={[0, 0.015, 0]}>
        <cylinderGeometry args={[0.58, 0.62, 0.03, 48]} />
        <meshStandardMaterial color="#2A2D31" roughness={0.9} metalness={0.08} />
      </mesh>
      <mesh position={[0, 0.17, 0]}>
        <cylinderGeometry args={[0.34, 0.42, 0.26, 48]} />
        <meshStandardMaterial color={DARK_METAL} roughness={0.7} metalness={0.42} />
      </mesh>
      <mesh position={[0, 0.34, 0]}>
        <cylinderGeometry args={[0.24, 0.28, 0.22, 40]} />
        <meshStandardMaterial color={BODY_METAL} roughness={0.5} metalness={0.38} />
      </mesh>
      <mesh position={[0, 0.48, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.2, 0.2, 0.38, 40]} />
        <meshStandardMaterial color={JOINT_WARNING} roughness={0.5} metalness={0.24} />
      </mesh>
      <mesh position={upperMid} quaternion={upperQuaternion}>
        <boxGeometry args={[0.18, upperLength, 0.22]} />
        <meshStandardMaterial color={BODY_METAL} roughness={0.5} metalness={0.38} />
      </mesh>
      <mesh position={chain.elbowPoint} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.18, 0.18, 0.28, 36]} />
        <meshStandardMaterial color={JOINT_WARNING} roughness={0.5} metalness={0.24} />
      </mesh>
      <mesh position={forearmMid} quaternion={forearmQuaternion}>
        <boxGeometry args={[0.16, forearmLength, 0.18]} />
        <meshStandardMaterial color={BODY_METAL} roughness={0.5} metalness={0.38} />
      </mesh>
      <group position={chain.wristPoint} quaternion={wristQuaternion}>
        <mesh>
          <boxGeometry args={[0.38, 0.13, 0.18]} />
          <meshStandardMaterial color={DARK_METAL} roughness={0.72} metalness={0.38} />
        </mesh>
        <mesh position={[0.2, -0.12, fingerZ]}>
          <boxGeometry args={[0.09, FINGER_HEIGHT, FINGER_THICKNESS]} />
          <meshStandardMaterial color={DARK_METAL} roughness={0.72} metalness={0.38} />
        </mesh>
        <mesh position={[0.2, -0.12, -fingerZ]}>
          <boxGeometry args={[0.09, FINGER_HEIGHT, FINGER_THICKNESS]} />
          <meshStandardMaterial color={DARK_METAL} roughness={0.72} metalness={0.38} />
        </mesh>
        {contactHighlight && (
          <>
            <mesh position={[0.2, -0.12, fingerZ]}>
              <boxGeometry args={[0.1, 0.34, 0.07]} />
              <meshBasicMaterial color="#38BDF8" transparent opacity={0.14} />
            </mesh>
            <mesh position={[0.2, -0.12, -fingerZ]}>
              <boxGeometry args={[0.1, 0.34, 0.07]} />
              <meshBasicMaterial color="#38BDF8" transparent opacity={0.14} />
            </mesh>
          </>
        )}
      </group>
      <group position={renderedCubePosition}>
        <mesh>
          <boxGeometry args={[CUBE_RENDER_SIZE, CUBE_RENDER_SIZE, CUBE_RENDER_SIZE]} />
          <meshStandardMaterial color="#D9534F" roughness={0.85} metalness={0.05} />
        </mesh>
        {(contactHighlight || attachProgress > 0.2) && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.18, 0]}>
            <ringGeometry args={[0.16, 0.18, 32]} />
            <meshBasicMaterial color="#38BDF8" transparent opacity={contactHighlight ? 0.36 : 0.18} />
          </mesh>
        )}
      </group>
      {restingPlacement && (
        <mesh position={[renderedCubePosition[0], 0.012, renderedCubePosition[2]]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.19, 0.215, 48]} />
          <meshBasicMaterial color="#10B981" transparent opacity={0.18} />
        </mesh>
      )}
      <mesh position={[ringOffset[0], 0.012, ringOffset[2]]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.28, 0.3, 48]} />
        <meshBasicMaterial color="#10B981" transparent opacity={0.42} />
      </mesh>
    </group>
  );
}
