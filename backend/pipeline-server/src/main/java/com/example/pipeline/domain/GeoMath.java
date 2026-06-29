package com.example.pipeline.domain;

import com.example.pipeline.api.dto.PipeConnectionDirectionDto;
import com.example.pipeline.api.dto.PipeCoordinateDto;
import com.example.pipeline.api.dto.PipeEndpointDto;
import java.util.List;

public final class GeoMath {
    private GeoMath() {
    }

    public static double distanceMeters(PipeEndpointDto start, PipeEndpointDto end) {
        return magnitude(subtract(ecef(start.lon(), start.lat(), start.height()), ecef(end.lon(), end.lat(), end.height())));
    }

    public static double angleBetween(PipeConnectionDirectionDto first, PipeConnectionDirectionDto second) {
        double dot = first.x() * second.x() + first.y() * second.y() + first.z() * second.z();
        double clamped = Math.max(-1, Math.min(1, dot));
        return Math.toDegrees(Math.acos(clamped));
    }

    public static Vector3 ecef(double lon, double lat, double height) {
        double a = 6378137.0;
        double e2 = 6.69437999014e-3;
        double lonRad = Math.toRadians(lon);
        double latRad = Math.toRadians(lat);
        double sinLat = Math.sin(latRad);
        double cosLat = Math.cos(latRad);
        double n = a / Math.sqrt(1 - e2 * sinLat * sinLat);
        double x = (n + height) * cosLat * Math.cos(lonRad);
        double y = (n + height) * cosLat * Math.sin(lonRad);
        double z = (n * (1 - e2) + height) * sinLat;
        return new Vector3(x, y, z);
    }

    public static PipeCoordinateDto geodetic(Vector3 ecef) {
        double a = 6378137.0;
        double e2 = 6.69437999014e-3;
        double lon = Math.atan2(ecef.y(), ecef.x());
        double p = Math.sqrt(ecef.x() * ecef.x() + ecef.y() * ecef.y());
        double lat = Math.atan2(ecef.z(), p * (1 - e2));
        double previous;
        do {
            previous = lat;
            double sin = Math.sin(lat);
            double n = a / Math.sqrt(1 - e2 * sin * sin);
            lat = Math.atan2(ecef.z() + e2 * n * sin, p);
        } while (Math.abs(lat - previous) > 1e-12);
        double sin = Math.sin(lat);
        double n = a / Math.sqrt(1 - e2 * sin * sin);
        double height = p / Math.cos(lat) - n;
        return new PipeCoordinateDto(Math.toDegrees(lon), Math.toDegrees(lat), height);
    }

    public static Vector3 subtract(Vector3 a, Vector3 b) {
        return new Vector3(a.x() - b.x(), a.y() - b.y(), a.z() - b.z());
    }

    public static Vector3 add(Vector3 a, Vector3 b) {
        return new Vector3(a.x() + b.x(), a.y() + b.y(), a.z() + b.z());
    }

    public static Vector3 multiply(Vector3 vector, double scalar) {
        return new Vector3(vector.x() * scalar, vector.y() * scalar, vector.z() * scalar);
    }

    public static double magnitude(Vector3 vector) {
        return Math.sqrt(vector.x() * vector.x() + vector.y() * vector.y() + vector.z() * vector.z());
    }

    public static Vector3 normalize(Vector3 vector) {
        double magnitude = magnitude(vector);
        if (magnitude < 1e-9) {
            return new Vector3(0, 0, 0);
        }
        return new Vector3(vector.x() / magnitude, vector.y() / magnitude, vector.z() / magnitude);
    }

    public static Vector3 average(List<Vector3> positions) {
        Vector3 sum = new Vector3(0, 0, 0);
        for (Vector3 position : positions) {
            sum = add(sum, position);
        }
        return multiply(sum, 1.0 / Math.max(1, positions.size()));
    }

    public record Vector3(double x, double y, double z) {
    }
}
