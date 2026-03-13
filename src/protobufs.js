import protobuf from 'protobufjs';

// Inline JSON descriptor — mirrors the relevant subset of the Meshtastic protobufs.
// Field numbers match the official meshtastic/protobufs definitions exactly.
const SCHEMA = {
  nested: {
    meshtastic: {
      nested: {
        PortNum: {
          values: {
            UNKNOWN_APP: 0,
            TEXT_MESSAGE_APP: 1,
            POSITION_APP: 3,
            ROUTING_APP: 5,
            NODEINFO_APP: 67,
          },
        },

        Data: {
          fields: {
            portnum:       { id: 1, type: 'PortNum' },
            payload:       { id: 2, type: 'bytes' },
            want_response: { id: 3, type: 'bool' },
            dest:          { id: 4, type: 'uint32' },
            source:        { id: 5, type: 'uint32' },
            request_id:    { id: 6, type: 'uint32' },
            reply_id:      { id: 7, type: 'uint32' },
            emoji:         { id: 8, type: 'uint32' },
          },
        },

        User: {
          fields: {
            id:          { id: 1, type: 'string' },
            long_name:   { id: 2, type: 'string' },
            short_name:  { id: 3, type: 'string' },
            macaddr:     { id: 4, type: 'bytes' },
            hw_model:    { id: 5, type: 'int32' },
            is_licensed: { id: 6, type: 'bool' },
          },
        },

        MeshPacket: {
          oneofs: {
            payload_variant: { oneof: ['decoded', 'encrypted'] },
          },
          fields: {
            from:          { id: 1,  type: 'fixed32' },
            to:            { id: 2,  type: 'fixed32' },
            channel:       { id: 3,  type: 'uint32' },
            decoded:       { id: 4,  type: 'Data' },
            encrypted:     { id: 5,  type: 'bytes' },   // current Meshtastic proto
            id:            { id: 6,  type: 'fixed32' },  // fixed32, not uint32
            rx_time:       { id: 7,  type: 'fixed32' },
            rx_snr:        { id: 8,  type: 'float' },
            hop_limit:     { id: 9,  type: 'uint32' },
            want_ack:      { id: 10, type: 'bool' },
            priority:      { id: 11, type: 'uint32' },
            rx_rssi:       { id: 12, type: 'int32' },
            via_mqtt:      { id: 14, type: 'bool' },
            hop_start:     { id: 15, type: 'uint32' },
            public_key:    { id: 16, type: 'bytes' },
            pki_encrypted: { id: 17, type: 'bool' },
            next_hop:      { id: 18, type: 'uint32' },
            relay_node:    { id: 19, type: 'uint32' },
          },
        },

        ServiceEnvelope: {
          fields: {
            packet:     { id: 1, type: 'MeshPacket' },
            channel_id: { id: 2, type: 'string' },
            gateway_id: { id: 3, type: 'string' },
          },
        },
      },
    },
  },
};

const root = protobuf.Root.fromJSON(SCHEMA);

export const ServiceEnvelope = root.lookupType('meshtastic.ServiceEnvelope');
export const MeshPacket      = root.lookupType('meshtastic.MeshPacket');
export const Data            = root.lookupType('meshtastic.Data');
export const User            = root.lookupType('meshtastic.User');
export const PortNum         = root.lookupEnum('meshtastic.PortNum').values;
