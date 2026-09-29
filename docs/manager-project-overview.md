# HouseLink Marketplace Backend - Manager Overview

## 1. Project Summary

HouseLink Marketplace Backend is the server-side system for an online marketplace platform.

It is responsible for handling user login, admin login, user profiles, delivery addresses, categories, brands, product attributes, image uploads, database storage, and secure API communication with the frontend.

In simple terms, this backend is the core engine that supports the marketplace application.

## 2. What This Project Does

The project currently provides these major features:

- Buyer login using phone or email OTP.
- Secure user sessions using protected cookies.
- Buyer profile and delivery address management.
- Admin login with password and MFA security.
- Admin management of categories.
- Admin management of brands.
- Admin management of category-based attributes such as size, color, and material.
- Admin media upload for category images and brand logos.
- Public APIs for frontend category and brand browsing.
- Database migrations and seed data.
- Health check APIs for deployment monitoring.
- Automated tests for important backend flows.

## 3. Business Value

This backend gives the marketplace a secure and scalable foundation.

Instead of hardcoding marketplace data, admins can manage categories, brands, and attributes from backend APIs. This makes the platform flexible for future product listings, seller onboarding, orders, and payments.

The authentication system is designed with security in mind, using OTP login for buyers and MFA login for admins.

## 4. Completed Modules

### Authentication Module

This module handles buyer login.

Buyers can request an OTP using phone or email. After verifying the OTP, the system creates a secure login session.

Completed features:

- OTP request.
- OTP verification.
- Secure login session.
- Refresh token rotation.
- Logout from current device.
- Logout from all devices.
- Current logged-in user API.

### Admin Authentication Module

This module handles admin login.

Admins log in using email and password, then complete MFA verification before accessing admin APIs.

Completed features:

- Admin password login.
- MFA setup.
- MFA verification.
- Recovery code support.
- Admin session refresh.
- Admin logout.
- Admin role validation.

### User Profile Module

This module handles buyer profile data.

Completed features:

- View profile.
- Update profile name and profile image.
- Manage delivery addresses.
- Set default delivery address.
- Delete address.

### Category Module

This module handles marketplace categories and subcategories.

Completed features:

- Public category listing.
- Category tree view.
- Category details by ID or slug.
- Admin category creation.
- Admin category update.
- Category visibility control.
- Category attribute connection.

### Attribute Module

This module allows the platform to define product-related fields dynamically.

Example:

- T-shirt size.
- Shoe size.
- Color.
- Material.
- Brand-specific specifications.

Completed features:

- Create attributes.
- Update attributes.
- Add attribute values.
- Update attribute values.
- Connect attributes to categories.
- Remove attributes from categories.

### Brand Module

This module manages brands in the marketplace.

Completed features:

- Public brand listing.
- Brand details by slug.
- Admin brand creation.
- Admin brand update.
- Brand approval.
- Brand rejection.

### Media Module

This module handles image upload for admin-managed marketplace assets.

Completed features:

- Upload category and brand images.
- Validate image upload.
- Store uploaded images.
- Delete uploaded media.
- Serve uploaded images publicly.
- Upload rate limiting.

### Database Module

The database is managed using Prisma and PostgreSQL.

Completed features:

- Database schema.
- Version-controlled migrations.
- Role seed data.
- Category seed data.
- Brand seed data.
- Type-safe database access.

### Security Layer

The backend includes security features across the application.

Completed features:

- Role-based access control.
- Secure cookies.
- CSRF protection.
- CORS protection.
- Request validation.
- Rate limiting.
- Centralized error handling.
- Environment-based configuration.

## 5. API Areas

The backend APIs are grouped into these areas:

- Health APIs.
- Buyer authentication APIs.
- Admin authentication APIs.
- User profile APIs.
- Address APIs.
- Public category APIs.
- Admin category APIs.
- Attribute APIs.
- Brand APIs.
- Media APIs.

These APIs are ready for frontend integration.

## 6. Technology Used

The backend is built using:

- Node.js for server runtime.
- Express.js for API routing.
- TypeScript for safer code.
- PostgreSQL for database storage.
- Prisma for database access and migrations.
- Zod for request validation.
- JWT and secure cookies for sessions.
- Argon2 for password hashing.
- TOTP MFA for admin security.
- Multer and Sharp for image upload processing.

## 7. How The System Works

### Buyer Flow

1. Buyer enters phone or email.
2. Backend creates an OTP challenge.
3. Buyer submits OTP.
4. Backend verifies OTP.
5. Backend creates or finds the buyer account.
6. Backend creates a secure session.
7. Buyer can access profile and address APIs.

### Admin Flow

1. Admin enters email and password.
2. Backend verifies credentials.
3. Admin completes MFA verification.
4. Backend creates an admin session.
5. Admin can manage categories, brands, attributes, and media.

### Marketplace Data Flow

1. Admin creates categories.
2. Admin creates attributes.
3. Admin maps attributes to categories.
4. Admin creates or approves brands.
5. Frontend uses public APIs to show categories and brands to users.

## 8. Current Status

The backend foundation is completed for authentication, admin access, users, addresses, categories, brands, attributes, media, database migrations, and testing.

The project is ready for frontend integration for the completed modules.

## 9. Pending Or Future Scope

The following marketplace modules can be developed next:

- Product listing.
- Seller onboarding.
- Seller approval workflow.
- Cart.
- Wishlist.
- Orders.
- Payments.
- Product reviews.
- Real SMS or email OTP provider integration.
- Admin dashboard frontend.
- Buyer marketplace frontend.

## 10. Manager-Friendly Explanation

You can explain the project like this:

> I developed the backend foundation for the HouseLink Marketplace platform. It includes secure buyer OTP login, admin login with MFA, buyer profile and address management, category management, brand management, dynamic product attributes, media upload, database migrations, role-based security, validation, and test coverage. The backend is structured module by module, so future features like products, orders, sellers, and payments can be added cleanly.

## 11. Short Presentation Script

Use this if you need to explain the work in a meeting:

> This project is the backend API for the HouseLink Marketplace. I built the main foundation required for a marketplace platform. Buyers can log in using OTP, admins can log in securely using password and MFA, and the system supports user profiles, addresses, categories, brands, dynamic attributes, and image uploads. The backend uses PostgreSQL with Prisma migrations, secure cookies, role-based access, validation, and testing. This gives us a strong base for the next phase, where we can add products, sellers, cart, orders, and payments.

## 12. One-Line Summary

HouseLink Marketplace Backend is a secure and scalable API foundation for managing users, admins, categories, brands, attributes, media, and future marketplace features.
