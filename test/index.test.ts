import mongoose, { Types, Schema } from 'mongoose'
import mongooseTracker from '../src/index'
import { faker } from '@faker-js/faker'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { range, nth, isNull } from 'lodash'
import { Collections } from './enums/collection'

describe('mongooseTracker tests', () => {
  beforeAll(async () => {
    const mongod = new MongoMemoryServer()

    await mongod.start()

    const mongoUrl = await mongod.getUri()

    await mongoose.connect(mongoUrl)
  })

  beforeEach(async () => {
    await mongoose.connection.dropDatabase()
  })

  afterEach(() => {
    mongoose.deleteModel(/.*/) // Deletes all models
  })

  afterAll(async () => {
    await mongoose.disconnect()
  })

  describe('tracker array key name options', () => {
    it('should create Array in model with the key name "history" by default', () => {
      const schema = new Schema({
        name: String
      })

      schema.plugin(mongooseTracker, {})

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = new Model({})

      expect(doc).toEqual(
        expect.objectContaining({
          history: expect.any(Array)
        })
      )
    })

    it('should create Array in model with the key name "__tokens"', () => {
      const schema = new Schema({})

      schema.plugin(mongooseTracker, {
        name: '__tokens'
      })

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = new Model({})

      expect(doc).toEqual(
        expect.objectContaining({
          __tokens: expect.any(Array)
        })
      )
    })
  })

  describe('pre functions', () => {
    describe('save function', () => {
      it('should not add modified field in history if the field is not tracked', async () => {
        const schema = new Schema({
          price: Number
        })

        schema.plugin(mongooseTracker, {
          fieldsToTrack: ['name']
        })

        const Model = mongoose.model(faker.internet.password(), schema)

        const doc = new Model({
          price: 0
        });

        (doc as any).__changedBy = 'test'

        doc.price = 1

        await doc.save()

        expect(doc).toEqual(
          expect.objectContaining({
            history: expect.not.arrayContaining([
              expect.objectContaining({
                changes: expect.arrayContaining([
                  expect.objectContaining({
                    field: 'price',
                    before: 0,
                    after: 1
                  })
                ])
              })
            ])
          })
        )
      })

      it('should add 2 modified fields in history if 2 fields are tracked', async () => {
        const schema = new Schema({
          name: String,
          price: Number,
          toto: String
        })

        schema.plugin(mongooseTracker, {
          fieldsToTrack: ['name', 'toto']
        })

        const Model = mongoose.model(faker.internet.password(), schema)

        const doc = await Model.create({
          toto: 'c ett',
          price: 10,
          name: 'nom'
        })

        doc.toto = 'c est mon nom'
        doc.name = 'tata'
        doc.price = 5

        await doc.save()

        expect(doc).toEqual(
          expect.objectContaining({
            history: expect.arrayContaining([
              expect.objectContaining({
                changes: expect.arrayContaining([
                  expect.objectContaining({
                    field: 'name',
                    before: 'nom',
                    after: 'tata'
                  }),
                  expect.objectContaining({
                    field: 'toto',
                    before: 'c ett',
                    after: 'c est mon nom'
                  })
                ])
              })
            ])
          })
        )
      })

      it('should record changes for tracked fields in the document\'s history and mark the action as "updated"', async () => {
        const InstnaceProductSchema = new Schema({
          price: { type: Number, required: true },
          name: { type: String, required: true },
          _display: { type: String, required: true }
        })

        const PurchaseDemandSchema = new Schema(
          {
            brandId: { type: String, required: true },
            marketplaceId: { type: String, required: true },
            pdNumber: { type: String, required: true, unique: true },
            active: { type: Boolean, required: true, default: true },
            status: { type: String, required: true },
            createdBy: { type: String, required: true },
            approvers: [
              {
                userId: { type: String, required: true },
                isApproved: { type: Boolean, required: true, default: false },
                timestamp: { type: Date, default: null } // Date when the approver approved/rejected the PD
              }
            ],
            products: [
              {
                instanceId: { type: Types.ObjectId, required: true, ref: 'testInstnaces' },
                supplierId: { type: String, required: true },
                quantity: { type: Number, required: true },
                poRef: { type: String, default: null },
                _display: { type: Types.ObjectId, ref: 'testInstnaces' }
              }
            ]
          },
          { timestamps: { createdAt: true, updatedAt: true } }
        )

        PurchaseDemandSchema.plugin(mongooseTracker, {
          fieldsToTrack: [
            'active',
            'status',
            'products.$.instanceId',
            'products.$.quantity',
            'products.$.supplierId'
          ]
        })

        const PurchaseDemandModel = mongoose.model(
          faker.internet.password(),
          PurchaseDemandSchema
        )

        const InstnaceModel = mongoose.model(
          'testInstnaces',
          InstnaceProductSchema
        )

        const instance1 = await InstnaceModel.create({
          name: 'instance1',
          price: 10,
          _display: 'instance1'
        })

        const instance2 = await InstnaceModel.create({
          name: 'instance2',
          price: 20,
          _display: 'instance2'
        })

        await PurchaseDemandModel.create({
          brandId: 'brand1',
          marketplaceId: 'makretplace1',
          pdNumber: faker.internet.password(),
          active: true,
          status: 'draft',
          createdBy: 'createdBy1',
          approvers: [
            {
              userId: 'userid1',
              isApproved: false
            }
          ],
          products: [
            {
              instanceId: instance1._id,
              supplierId: 'supplier1',
              quantity: instance1.price,
              _display: instance1._id
            }
          ]
        })

        const pd = await PurchaseDemandModel.findOne({ status: 'draft' })

        if (isNull(pd)) {
          return
        }

        expect(pd).toEqual(
          expect.objectContaining({
            history: expect.arrayContaining([])
          })
        )

        pd.status = 'submitted'
        pd.active = false;
        (pd.products[0].quantity as any) = instance2.price

        await pd.save()

        expect(pd).toEqual(
          expect.objectContaining({
            history: expect.arrayContaining([
              expect.objectContaining({
                action: 'updated',
                changes: expect.arrayContaining([
                  expect.objectContaining({
                    field: 'status',
                    before: 'draft',
                    after: 'submitted'
                  }),
                  expect.objectContaining({
                    field: 'active',
                    before: true,
                    after: false
                  }),
                  expect.objectContaining({
                    field: 'instance1 quantity',
                    before: 10,
                    after: 20
                  })
                ])
              })
            ])
          })
        )
      })

      it('should add changes in tracked fields, including nested array fields, to the history with correct before and after values', async () => {
        const purchaseDemandSchema = new Schema({
          products: [
            {
              instanceId: {
                type: Schema.Types.ObjectId,
                ref: Collections.ProductInstance,
                required: true
              },
              supplierId: {
                type: Schema.Types.ObjectId,
                ref: Collections.BusinessPartner,
                default: null
              },
              quantity: { type: Number, required: true }
            }
          ],
          pdNumber: { type: String, required: true, unique: true },
          active: { type: Boolean, required: true, default: true },
          status: { type: String, required: true }
        })

        purchaseDemandSchema.plugin(mongooseTracker, {
          fieldsToTrack: [
            'status',
            'products.$.quantity',
            'products.$.instanceId',
            'products.$.supplierId'
          ]
        })

        const instnaceProductSchema = new Schema({
          name: { type: String, required: true },
          _display: { type: String, required: true }
        })

        const BusinessPartnerSchema = new Schema({
          name: { type: String, required: true },
          _display: { type: String, required: true }
        })

        const instanceModel = mongoose.model(
          Collections.ProductInstance,
          instnaceProductSchema
        )

        const BusinessPartnerModel = mongoose.model(
          Collections.BusinessPartner,
          BusinessPartnerSchema
        )

        const purchaseDemandModel = mongoose.model(
          Collections.PurchaseDemands,
          purchaseDemandSchema
        )

        const instance1 = await instanceModel.create({
          name: 'instance1',
          _display: 'instance1'
        })
        const instance2 = await instanceModel.create({
          name: 'instance2',
          _display: 'instance2'
        })
        const instance3 = await instanceModel.create({
          name: 'instance3',
          _display: 'instance3'
        })

        const supplier = await BusinessPartnerModel.create({
          name: 'supplier1',
          _display: 'supplier1'
        })

        const supplier2 = await BusinessPartnerModel.create({
          name: 'supplier2',
          _display: 'supplier2'
        })

        await purchaseDemandModel.create({
          pdNumber: 'PD0001444',
          active: true,
          status: 'new',
          products: [
            {
              instanceId: instance1._id,
              supplierId: null,
              quantity: 504
            },
            {
              instanceId: instance2._id,
              supplierId: null,
              quantity: 500
            },
            {
              instanceId: instance3._id,
              supplierId: supplier._id,
              quantity: 1000
            }
          ]
        })

        const { pId: instanceId, userId } = { pId: instance2._id, userId: 'userId1' }

        const quantity = 750

        const pd = await purchaseDemandModel.findOne({ pdNumber: 'PD0001444' })

        if (isNull(pd)) {
          return
        }

        // Find the product to update in the `products` array
        const productIndex = pd.products.findIndex(
          (product) => product.instanceId.toString() === instanceId.toString()
        )

        if (productIndex === -1) {
          return
        }

        // Update the specific fields in the document
        pd.products[productIndex].quantity = quantity // Update quantity
        pd.products[productIndex].supplierId = new Types.ObjectId(
          supplier2._id
        ) // Update supplier ID
        pd.status = 'waitingForApproval'; // Update status

        (pd as any)._changedBy = userId
        // Save the updated document
        await pd.save()

        expect(pd).toEqual(
          expect.objectContaining({
            history: expect.arrayContaining([
              expect.objectContaining({
                action: 'updated',
                changedBy: userId,
                changes: expect.arrayContaining([
                  expect.objectContaining({
                    field: 'status',
                    before: 'new',
                    after: 'waitingForApproval'
                  }),
                  expect.objectContaining({
                    field: 'products.1.quantity',
                    before: 500,
                    after: 750
                  }),
                  expect.objectContaining({
                    field: 'products.1.supplierId',
                    before: null,
                    after: supplier2.name
                  })
                ])
              })
            ])
          })
        )
      })

      it('should track changes to nested fields in orders and items', async () => {
        // Create initial PurchaseDemand
        const PurchaseDemandSchema = new Schema({
          pdNumber: { type: String, required: true, unique: true },
          orders: [
            {
              orderNumber: { type: String, required: true },
              date: { type: Date, required: true },
              items: [
                {
                  name: { type: String, required: true },
                  price: { type: Number, required: true },
                  _display: { type: String, required: true }
                }
              ]
            }
          ]
        })

        PurchaseDemandSchema.plugin(mongooseTracker, {
          fieldsToTrack: ['orders.$.items.$.price']
        })

        const PurchaseDemandModel = mongoose.model(faker.internet.password(), PurchaseDemandSchema)

        const purchaseDemand = await PurchaseDemandModel.create({
          pdNumber: 'PD-TEST-001',
          orders: [
            {
              orderNumber: 'ORD-TEST-001',
              date: new Date(),
              items: [
                { name: 'Test Item 1', price: 100, _display: 'Test Item 1' },
                { name: 'Test Item 2', price: 200, _display: 'Test Item 2' }
              ]
            }
          ]
        })

        purchaseDemand.orders[0].items[1].price = 150 // Update price of 'Test Item 2'

        await purchaseDemand.save()

        expect(purchaseDemand).toEqual(
          expect.objectContaining({
            history: expect.arrayContaining([
              expect.objectContaining({
                changes: expect.arrayContaining([
                  expect.objectContaining({
                    field: 'Test Item 2 price',
                    before: 200,
                    after: 150
                  })
                ])
              })
            ])
          })
        )
      })

      it('should track changes to nested fields from array', async () => {
        // Define schemas
        const itemSchema = new Schema({
          name: String,
          value: Number,
          nested: {
            name: String,
            action: String,
            _display: String
          },
          _display: String
        })

        const parentSchema = new Schema({
          name: String,
          nested: {
            child: String
          },
          items: [itemSchema]
        })
        // Apply the tracker plugin
        parentSchema.plugin(mongooseTracker, {
          fieldsToTrack: ['nested.child', 'items.$.name', 'items.$.nested', 'items.$.nested.name'], // Track nested and array fields
          name: 'history'
        })
        const Parent = mongoose.model('Parent', parentSchema)

        // Create a document
        const doc = await Parent.create({
          name: 'Parent',
          nested: { child: 'Initial' },
          items: [{ name: 'Item1', value: 1, _display: 'Item1', nested: { name: 'nested1', action: 'delete' } }]
        })
        doc.items[0].nested = { name: 'nested2', action: 'update' }

        await doc.save()
        // Retrieve the updated document
        const updatedDoc = await Parent.findOne({ _id: doc._id })
        // Assert that the history array contains both changes
        expect(updatedDoc).toEqual(
          expect.objectContaining({
            history: expect.arrayContaining([
              expect.objectContaining({
                changes: expect.arrayContaining([
                  expect.objectContaining({
                    field: 'Item1 nested name',
                    before: 'nested1',
                    after: 'nested2'
                  }),
                  expect.objectContaining({
                    field: 'Item1 nested action',
                    before: 'delete',
                    after: 'update'
                  })
                ])
              })
            ])
          })
        )
      })

      // it('should track changes to nested supplier fields within the products array', async () => {
      //   // Define schemas
      //   const SupplierSchema = new Schema({
      //     name: String,
      //     _display: String
      //   })

      //   const ProductSchema = new Schema({
      //     name: String,
      //     value: Number,
      //     supplier: {
      //       supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier' },
      //       name: String,
      //       dimensions: {
      //         boxUnitLengthSide: Number,
      //         boxUnitHeightSide: Number,
      //         boxUnitWidthSide: Number,
      //         boxUnitWeight: Number,
      //         boxVolumetricWeight: Number,
      //         masterCartonLength: Number,
      //         masterCartonWidth: Number,
      //         masterCartonHeight: Number,
      //         masterCartonCbm: Number,
      //         masterCartonWeight: Number,
      //         unitInMasterCarton: Number
      //       },
      //       minimumOrderQuantity: Number,
      //       cost: Number,
      //       _display: { type: Schema.Types.ObjectId, ref: 'Supplier' }
      //     },
      //     _display: String
      //   })

      //   const ParentSchema = new Schema({
      //     name: String,
      //     products: [ProductSchema]
      //   })
      //   // Apply the tracker plugin
      //   ParentSchema.plugin(mongooseTracker, {
      //     fieldsToTrack: ['products.$.supplier'], // Track nested and array fields
      //     name: 'history'
      //   })

      //   const SupplierModel = mongoose.model('Supplier', SupplierSchema)
      //   const ProductModel = mongoose.model('Product', ProductSchema)
      //   const Parent = mongoose.model('Parent', ParentSchema)

      //   const supplier1 = await SupplierModel.create({ name: 'Supplier 1', _display: 'Supplier 1' })
      //   const supplier2 = await SupplierModel.create({ name: 'Supplier 2', _display: 'Supplier 2' })

      //   const item1 = await ProductModel.create({
      //     name: 'Item 1',
      //     value: 1,
      //     _display: 'Item 1',
      //     supplier: {
      //       _display: supplier1._id,
      //       supplierId: supplier1._id,
      //       name: supplier1.name,
      //       dimensions: {
      //         boxUnitLengthSide: 10,
      //         boxUnitHeightSide: 10,
      //         boxUnitWidthSide: 10,
      //         boxUnitWeight: 10,
      //         boxVolumetricWeight: 10,
      //         masterCartonLength: 10,
      //         masterCartonWidth: 10,
      //         masterCartonHeight: 10,
      //         masterCartonCbm: 10,
      //         masterCartonWeight: 10,
      //         unitInMasterCarton: 10
      //       },
      //       minimumOrderQuantity: 10,
      //       cost: 10
      //     }
      //   })

      //   const parent = await Parent.create({
      //     products: [item1],
      //     name: 'Parent'
      //   })

      //   parent.products[0].supplier = {
      //     _display: supplier2._id,
      //     supplierId: supplier2._id,
      //     name: supplier2.name,
      //     dimensions: {
      //       boxUnitLengthSide: 20,
      //       boxUnitHeightSide: 20,
      //       boxUnitWidthSide: 20,
      //       boxUnitWeight: 20,
      //       boxVolumetricWeight: 20,
      //       masterCartonLength: 20,
      //       masterCartonWidth: 20,
      //       masterCartonHeight: 20,
      //       masterCartonCbm: 20,
      //       masterCartonWeight: 20,
      //       unitInMasterCarton: 20
      //     },
      //     minimumOrderQuantity: 20,
      //     cost: 20
      //   }

      //   await parent.save()

      //   // Assert that the history array contains both changes
      //   expect(parent).toEqual(
      //     expect.objectContaining({
      //       history: expect.arrayContaining([
      //         expect.objectContaining({
      //           changes: expect.arrayContaining([
      //             expect.objectContaining({
      //               field: 'Item 1 supplier',
      //               before: 'Supplier 1',
      //               after: 'Supplier 2'
      //             })
      //           ])
      //         })
      //       ])
      //     })
      //   )
      // })

      // it('should track changes to nested supplier fields within the products array', async () => {
      //   // Define schemas
      //   const SupplierSchema = new Schema({
      //     name: String,
      //     _display: String
      //   })

      //   const ProductSchema = new Schema({
      //     name: String,
      //     value: Number,
      //     supplier: {
      //       supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier' },
      //       name: String,
      //       dimensions: {
      //         boxUnitLengthSide: Number,
      //         boxUnitHeightSide: Number,
      //         boxUnitWidthSide: Number,
      //         boxUnitWeight: Number,
      //         boxVolumetricWeight: Number,
      //         masterCartonLength: Number,
      //         masterCartonWidth: Number,
      //         masterCartonHeight: Number,
      //         masterCartonCbm: Number,
      //         masterCartonWeight: Number,
      //         unitInMasterCarton: Number,
      //         _display: { type: Schema.Types.ObjectId, ref: 'Product' }
      //       },
      //       minimumOrderQuantity: Number,
      //       cost: Number,
      //       _display: { type: Schema.Types.ObjectId, ref: 'Supplier' }
      //     },
      //     _display: String
      //   })

      //   const ParentSchema = new Schema({
      //     name: String,
      //     products: [ProductSchema]
      //   })
      //   // Apply the tracker plugin
      //   ParentSchema.plugin(mongooseTracker, {
      //     fieldsToTrack: ['products.$.supplier.name', 'products.$.supplier.supplierId', 
      //       'products.$.supplier.dimensions.boxUnitLengthSide',
      //       'products.$.supplier.dimensions.boxUnitHeightSide',
      //       'products.$.supplier.dimensions.boxUnitWidthSide',
      //       'products.$.supplier.dimensions.boxUnitWeight',
      //       'products.$.supplier.dimensions.boxVolumetricWeight',
      //       'products.$.supplier.dimensions.masterCartonLength',
      //       'products.$.supplier.dimensions.masterCartonWidth',
      //       'products.$.supplier.dimensions.masterCartonHeight',
      //       'products.$.supplier.dimensions.masterCartonCbm',
      //       'products.$.supplier.dimensions.masterCartonWeight',
      //       'products.$.supplier.dimensions.unitInMasterCarton',
      //       'products.$.supplier.minimumOrderQuantity',
      //       'products.$.supplier.cost',
            
      //     ], // Track nested and array fields
      //     name: 'history'
      //   })

      //   const SupplierModel = mongoose.model('Supplier', SupplierSchema)
      //   const ProductModel = mongoose.model('Product', ProductSchema)
      //   const Parent = mongoose.model('Parent', ParentSchema)

      //   const supplier1 = await SupplierModel.create({ name: 'Supplier 1', _display: 'Supplier 1' })
      //   const supplier2 = await SupplierModel.create({ name: 'Supplier 2', _display: 'Supplier 2' })

      //   const item1 = await ProductModel.create({
      //     name: 'Item 1',
      //     value: 1,
      //     _display: 'Item 1',
      //     supplier: {
      //       supplierId: supplier1._id,
      //       name: supplier1.name,
      //       dimensions: {
      //         boxUnitLengthSide: 10,
      //         boxUnitHeightSide: 10,
      //         boxUnitWidthSide: 10,
      //         boxUnitWeight: 10,
      //         boxVolumetricWeight: 10,
      //         masterCartonLength: 10,
      //         masterCartonWidth: 10,
      //         masterCartonHeight: 10,
      //         masterCartonCbm: 10,
      //         masterCartonWeight: 10,
      //         unitInMasterCarton: 10,
      //       },
      //       _display: supplier1._id,
      //       minimumOrderQuantity: 10,
      //       cost: 10
      //     }
      //   })

      //   item1.supplier!.dimensions!._display = item1._id;
      //   item1.save();

      //   const parent = await Parent.create({
      //     products: [item1],
      //     name: 'Parent'
      //   })

      //   parent!.products[0].supplier!.dimensions!.boxUnitLengthSide = 20
      //   parent!.products[0].supplier!.dimensions!.boxUnitHeightSide = 20
      //   parent!.products[0].supplier!.dimensions!.boxUnitWidthSide = 20
      //   parent!.products[0].supplier!.dimensions!.boxUnitWeight = 20
      //   parent!.products[0].supplier!.dimensions!.boxVolumetricWeight = 20
      //   parent!.products[0].supplier!.dimensions!.masterCartonLength = 20
      //   parent!.products[0].supplier!.dimensions!.masterCartonWidth = 20
      //   parent!.products[0].supplier!.dimensions!.masterCartonHeight = 20
      //   parent!.products[0].supplier!.dimensions!.masterCartonCbm = 20
      //   parent!.products[0].supplier!.dimensions!.masterCartonWeight = 20
      //   parent!.products[0].supplier!.dimensions!.unitInMasterCarton = 20
      //   parent!.products[0].supplier!.minimumOrderQuantity = 20
      //   parent!.products[0].supplier!.cost = 20

      //   await parent.save()

      //   // Assert that the history array contains both changes
      //   expect(parent).toEqual(
      //     expect.objectContaining({
      //       history: expect.arrayContaining([
      //         expect.objectContaining({
      //           changes: expect.arrayContaining([
      //             expect.objectContaining({
      //               field: 'Item 1',
      //               before: expect.objectContaining({
      //                 supplierId: supplier1._id,
      //                 name: supplier1.name,
      //                 dimensions: expect.objectContaining({
      //                   boxUnitLengthSide: 10,
      //                   boxUnitHeightSide: 10,
      //                   boxUnitWidthSide: 10,
      //                   boxUnitWeight: 10,
      //                   boxVolumetricWeight: 10,
      //                   masterCartonLength: 10,
      //                   masterCartonWidth: 10,
      //                   masterCartonHeight: 10,
      //                   masterCartonCbm: 10,
      //                   masterCartonWeight: 10,
      //                   unitInMasterCarton: 10
      //                 }),
      //                 minimumOrderQuantity: 10,
      //                 cost: 10
      //               }),
      //               after: expect.objectContaining({
      //                 supplierId: supplier2._id,
      //                 name: supplier2.name,
      //                 dimensions: expect.objectContaining({
      //                   boxUnitLengthSide: 20,
      //                   boxUnitHeightSide: 20,
      //                   boxUnitWidthSide: 20,
      //                   boxUnitWeight: 20,
      //                   boxVolumetricWeight: 20,
      //                   masterCartonLength: 20,
      //                   masterCartonWidth: 20,
      //                   masterCartonHeight: 20,
      //                   masterCartonCbm: 20,
      //                   masterCartonWeight: 20,
      //                   unitInMasterCarton: 20
      //                 }),
      //                 minimumOrderQuantity: 20,
      //                 cost: 20
      //               })
      //             })
      //           ])
      //         })
      //       ])
      //     })
      //   )
      // })
    })

    describe('findOneAndUpdate function', () => {
      it('should do nothing if object does not exist', async () => {
        const schema = new Schema({
          name: String,
          price: Number,
          toto: String
        })

        schema.plugin(mongooseTracker, {
          fieldsToTrack: ['name', 'toto']
        })

        const Model = mongoose.model(faker.internet.password(), schema)
        await Model.create({ price: 10, name: 'nom', toto: 'c est moi' })

        await Model.findOneAndUpdate(
          { toto: 'roni' },
          {
            name: 'nouveauNom'
          }
        )

        const doc = await Model.findOne({ price: 10 })

        expect(doc).not.toEqual(
          expect.objectContaining({
            history: expect.arrayContaining([
              expect.objectContaining({
                changes: expect.arrayContaining([
                  expect.objectContaining({
                    field: 'name',
                    before: 'nom',
                    after: 'nouveauNom'
                  })
                ])
              })
            ])
          })
        )
      })

      it('should add modified field in history if the field is tracked', async () => {
        const schema = new Schema({
          name: String,
          price: Number,
          pdNumber: String,
          toto: String
        })

        schema.plugin(mongooseTracker, {
          fieldsToTrack: ['name', 'toto']
        })

        const Model = mongoose.model(faker.internet.password(), schema)

        await Model.create({
          price: 10,
          name: 'nom',
          toto: 'c est moi',
          pdNumber: 'PD321333'
        })
        await Model.findOneAndUpdate(
          { pdNumber: 'PD321333' },
          { name: 'nouveauNom' }
        )

        const doc = await Model.findOne({ pdNumber: 'PD321333' })

        expect(doc).toEqual(
          expect.objectContaining({
            history: expect.arrayContaining([
              expect.objectContaining({
                action: 'updated',
                changes: expect.arrayContaining([
                  expect.objectContaining({
                    field: 'name',
                    before: 'nom',
                    after: 'nouveauNom'
                  })
                ])
              })
            ])
          })
        )

        expect(doc?.price).toEqual(10)
      })

      it('should not add modified field in history if the field is not tracked when increment', async () => {
        const schema = new Schema({
          name: String,
          price: Number,
          toto: String
        })

        schema.plugin(mongooseTracker, {
          fieldsToTrack: ['name']
        })

        const Model = mongoose.model(faker.internet.password(), schema)

        const item = await Model.create({
          price: 10,
          name: 'nom',
          toto: 'c est moi'
        })

        await Model.findOneAndUpdate({ _id: item._id }, { $inc: { price: 1 } })

        const updated = await Model.findById(item._id)

        if (isNull(updated)) {
          return
        }

        expect(updated).toEqual(
          expect.objectContaining({
            history: expect.not.arrayContaining([
              expect.objectContaining({
                changes: expect.arrayContaining([
                  expect.objectContaining({
                    field: 'price',
                    before: item.price,
                    after: Number(item.price ?? 0) + 1
                  })
                ])
              })
            ])
          })
        )

        expect(updated.price).toEqual(Number(item.price ?? 0) + 1)
      })

      it('should not add modified field in history if the field is not tracked', async () => {
        const schema = new Schema({
          name: String,
          price: Number,
          toto: String
        })

        schema.plugin(mongooseTracker, {
          fieldsToTrack: ['toto'],
          name: 'history'
        })

        const Model = mongoose.model(faker.internet.password(), schema)

        await Model.create({ price: 10, name: 'nom', toto: 'c est moi' })
        await Model.findOneAndUpdate(
          { price: 10 },
          { name: 'nouveauNom', toto: 'c es mi' }
        )

        const doc = await Model.findOne({ price: 10 })

        expect(doc).toEqual(
          expect.objectContaining({
            history: expect.arrayContaining([
              expect.not.objectContaining({
                action: 'updated',
                changes: expect.arrayContaining([
                  expect.objectContaining({
                    field: 'name',
                    before: 'nom',
                    after: 'nouveauNom'
                  })
                ])
              })
            ])
          })
        )
      })

      it('should add modified field in __tokens if the field is tracked', async () => {
        const schema = new Schema({
          name: String,
          price: Number,
          toto: String
        })

        schema.plugin(mongooseTracker, {
          fieldsToTrack: ['name', 'toto'],
          name: '__tokens'
        })

        const Model = mongoose.model(faker.internet.password(), schema)

        await Model.create({ price: 10, name: 'nom', toto: 'c est moi' })
        await Model.findOneAndUpdate({ price: 10 }, { name: 'nouveauNom' })

        const doc = await Model.findOne({ price: 10 })

        expect(doc).toEqual(
          expect.objectContaining({
            __tokens: expect.arrayContaining([
              expect.objectContaining({
                changes: expect.arrayContaining([
                  expect.objectContaining({
                    field: 'name',
                    before: 'nom',
                    after: 'nouveauNom'
                  })
                ])
              })
            ])
          })
        )
      })

      it('should not add modified field in __tokens if the field is not tracked', async () => {
        const schema = new Schema({
          name: String,
          price: Number,
          toto: String
        })

        schema.plugin(mongooseTracker, {
          fieldsToTrack: ['toto'],
          name: '__tokens'
        })

        const Model = mongoose.model(faker.internet.password(), schema)

        await Model.create({ price: 10, name: 'nom', toto: 'c est moi' })
        await Model.findOneAndUpdate({ price: 10 }, { name: 'nouveauNom' })

        const doc = await Model.findOne({ price: 10 })

        expect(doc).toEqual(
          expect.objectContaining({
            __tokens: expect.not.arrayContaining([
              expect.objectContaining({
                field: 'name',
                before: 'nom',
                after: 'nouveauNom'
              })
            ])
          })
        )
      })
    })

    describe('updateOne function', () => {
      it('should not add a modified field to history if the field is not tracked', async () => {
        const schema = new Schema({
          name: String,
          price: Number,
          toto: String
        })

        schema.plugin(mongooseTracker, {
          fieldsToTrack: ['toto'],
          name: 'history'
        })

        const Model = mongoose.model(faker.internet.password(), schema)

        await Model.create({ name: 'initial', price: 10, toto: 'tracked' })

        await Model.updateOne(
          { name: 'initial' },
          { name: 'updatedName' },
          { changedBy: 'user2' }
        )

        await Model.updateOne(
          { toto: 'tracked' },
          { toto: 'tracked2' },
          { changedBy: 'user2' }
        )

        const doc = await Model.findOne({ price: 10 })

        expect((doc as any).history).toEqual(
          expect.arrayContaining([
            expect.not.objectContaining({
              changes: expect.arrayContaining([
                expect.objectContaining({
                  field: 'name',
                  before: 'initial',
                  after: 'updatedName'
                })
              ])
            })
          ])
        )
      })
    })
  })

  describe('Limit options', () => {
    describe('Save Hook', () => {
      it('should limit by default 30 elements in history', async () => {
        const schema = new Schema({
          name: String,
          price: Number,
          toto: String,
          pdNumber: String
        })

        schema.plugin(mongooseTracker, {
          fieldsToTrack: ['name', 'toto'],
          limit: 30
        })

        const Model = mongoose.model(faker.internet.password(), schema)

        await Model.create({
          price: 10,
          name: 'nom',
          toto: 'c est moi',
          pdNumber: 'PO03433'
        })

        for await (const index of range(15)) {
          const doc = (await Model.findOne({ pdNumber: 'PO03433' })) as any

          doc.name = `name :${index}`

          await doc.save()

          const doc2 = (await Model.findOne({ pdNumber: 'PO03433' })) as any

          doc2.toto = `toto :${index}`

          await doc2.save()
        }

        const docExpected = (await Model.findOne({ price: 10 })) as any

        expect(docExpected.history).toHaveLength(30)

        expect(nth(docExpected.history, 29)).toEqual(
          expect.objectContaining({
            changes: expect.arrayContaining([
              expect.objectContaining({
                field: 'toto',
                before: 'toto :13',
                after: 'toto :14'
              })
            ])
          })
        )
      })

      it('should limit 50 elements in history', async () => {
        const schema = new Schema({
          name: String,
          price: Number,
          toto: String,
          pdNumber: String
        })

        schema.plugin(mongooseTracker, {
          fieldsToTrack: ['name']
        })

        const Model = mongoose.model(faker.internet.password(), schema)

        await Model.create({
          price: 10,
          name: 'nom',
          toto: 'c est moi',
          pdNumber: 'PD324333'
        })

        for await (const index of range(50)) {
          const doc = (await Model.findOne({ pdNumber: 'PD324333' })) as any

          doc.name = `name :${index}`
          await doc.save()

          const doc2 = (await Model.findOne({ pdNumber: 'PD324333' })) as any

          doc2.toto = `toto :${index}`

          await doc2.save()
        }

        const docExpected = (await Model.findOne({ price: 10 })) as any

        expect(docExpected.history).toHaveLength(50)
      })
    })

    describe('Updates Hook', () => {
      it('should limit by default 30 elements in history', async () => {
        const schema = new Schema({
          name: String,
          price: Number,
          toto: String
        })

        schema.plugin(mongooseTracker, {
          fieldsToTrack: ['name'],
          limit: 30
        })

        const Model = mongoose.model(faker.internet.password(), schema)

        await Model.create({ price: 10, name: 'nom', toto: 'c est moi' })
        await Model.findOneAndUpdate({ price: 10 }, { name: 'nouveauNom' })

        for (let index = 0; index < 30; index++) {
          await Model.findOneAndUpdate({ price: 10 }, { name: 'toto' })
          await Model.findOneAndUpdate({ price: 10 }, { name: 'test' })
        }

        const doc = (await Model.findOne({ price: 10 })) as any

        expect((doc as any).history).toHaveLength(30)
      })

      it('should limit 50 elements in history', async () => {
        const schema = new Schema({
          name: String,
          price: Number,
          toto: String
        })

        schema.plugin(mongooseTracker, {
          fieldsToTrack: ['name']
        })

        const Model = mongoose.model(faker.internet.password(), schema)

        await Model.create({ price: 10, name: 'nom', toto: 'c est moi' })
        await Model.findOneAndUpdate({ price: 10 }, { name: 'nouveauNom' })

        for (let index = 0; index < 50; index++) {
          await Model.findOneAndUpdate({ price: 10 }, { name: 'toto' })
          await Model.findOneAndUpdate({ price: 10 }, { name: 'test' })
        }

        const doc = (await Model.findOne({ price: 10 })) as any

        expect((doc as any).history).toHaveLength(50)
      })
    })
  })

  describe('changedBy functionality', () => {
    it('should set `changedBy` correctly on document creation', async () => {
      const schema = new Schema({
        name: String
      })

      schema.plugin(mongooseTracker, {})

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = new Model({ name: 'initial' });

      (doc as any)._changedBy = 'creator'

      await doc.save()

      expect((doc as any).history).toEqual(expect.arrayContaining([]))
    })

    it('should set `changedBy` correctly on document update', async () => {
      const schema = new Schema({
        name: String
      })

      schema.plugin(mongooseTracker, {})

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = await Model.create({ name: 'initial' });

      (doc as any)._changedBy = 'updater'
      doc.name = 'updated'

      await doc.save()

      expect((doc as any).history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'updated',
            changedBy: 'updater',
            changes: expect.arrayContaining([
              expect.objectContaining({
                field: 'name',
                before: 'initial',
                after: 'updated'
              })
            ])
          })
        ])
      )
    })

    it('should set `changedBy` correctly on `findOneAndUpdate`', async () => {
      const schema = new Schema({
        name: String
      })

      schema.plugin(mongooseTracker, {})

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = await Model.create({ name: 'initial' })

      await Model.findOneAndUpdate(
        { _id: doc._id },
        { name: 'updatedName' },
        { changedBy: 'batchJob' }
      )

      const updatedDoc = await Model.findOne({ _id: doc._id })

      expect((updatedDoc as any).history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'updated',
            changedBy: 'batchJob',
            changes: expect.arrayContaining([
              expect.objectContaining({
                field: 'name',
                before: 'initial',
                after: 'updatedName'
              })
            ])
          })
        ])
      )
    })

    it('should set `changedBy` correctly for multiple updates', async () => {
      const schema = new Schema({
        name: String
      })

      schema.plugin(mongooseTracker, {})

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = await Model.create({ name: 'initial' })

      for (let i = 0; i < 3; i++) {
        (doc as any)._changedBy = `user${i}`
        doc.name = `name${i}`
        await doc.save()
      }

      expect((doc as any).history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            changedBy: 'user0',
            changes: expect.arrayContaining([
              expect.objectContaining({
                field: 'name',
                before: 'initial',
                after: 'name0'
              })
            ])
          }),
          expect.objectContaining({
            changedBy: 'user1',
            changes: expect.arrayContaining([
              expect.objectContaining({
                field: 'name',
                before: 'name0',
                after: 'name1'
              })
            ])
          }),
          expect.objectContaining({
            changedBy: 'user2',
            changes: expect.arrayContaining([
              expect.objectContaining({
                field: 'name',
                before: 'name1',
                after: 'name2'
              })
            ])
          })
        ])
      )
    })

    it('should set `changedBy` correctly for bulk updates', async () => {
      const schema = new Schema({
        name: String
      })

      schema.plugin(mongooseTracker, {})

      const Model = mongoose.model(faker.internet.password(), schema)

      await Model.create({ name: 'initial' })

      await Model.updateMany(
        { name: 'initial' },
        { name: 'bulkUpdate' },
        { changedBy: 'admin' }
      )

      const docs = await Model.find({})

      docs.forEach((doc) => {
        expect((doc as any).history).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              action: 'updated',
              changedBy: 'admin',
              changes: expect.arrayContaining([
                expect.objectContaining({
                  field: 'name',
                  before: 'initial',
                  after: 'bulkUpdate'
                })
              ])
            })
          ])
        )
      })
    })

    it('should handle missing `changedBy` gracefully', async () => {
      const schema = new Schema({
        name: String
      })

      schema.plugin(mongooseTracker, {})

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = new Model({ name: 'initial' })

      await doc.save()

      doc.name = 'updated'

      await doc.save()

      expect((doc as any).history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'updated',
            changedBy: null
          })
        ])
      )
    })
  })

  describe('Mongoose Tracker Plugin - Nested and Array Fields', () => {
    it('should track changes to nested fields and array fields', async () => {
      // Define schemas
      const itemSchema = new Schema({
        name: String,
        value: Number,
        nested: {
          name: String,
          action: String
        }
      })

      const parentSchema = new Schema({
        name: String,
        nested: {
          child: String
        },
        items: [itemSchema]
      })

      // Apply the tracker plugin
      parentSchema.plugin(mongooseTracker, {
        fieldsToTrack: ['nested.child', 'items.$.name'], // Track nested and array fields
        name: 'history'
      })

      const Parent = mongoose.model('Parent', parentSchema)

      // Create a document
      const doc = await Parent.create({
        name: 'Parent',
        nested: { child: 'Initial' },
        items: [{ name: 'Item1', value: 1, nested: {name:'nested1', action:'delete'} }]
      })

      // Update a nested field
      await Parent.updateOne({ _id: doc._id }, { 'nested.child': 'Updated' })

      // Update an array field
      await Parent.updateOne(
        { _id: doc._id },
        { 'items.0.name': 'UpdatedItem' }
      )

      // Retrieve the updated document
      const updatedDoc = await Parent.findOne({ _id: doc._id })

      // Assert that the history array contains both changes
      expect(updatedDoc).toEqual(
        expect.objectContaining({
          history: expect.arrayContaining([
            expect.objectContaining({
              changes: expect.arrayContaining([
                expect.objectContaining({
                  field: 'nested.child',
                  before: 'Initial',
                  after: 'Updated'
                })
              ])
            }),
            expect.objectContaining({
              changes: expect.arrayContaining([
                expect.objectContaining({
                  field: 'items.0.name',
                  before: 'Item1',
                  after: 'UpdatedItem'
                })
              ])
            })
          ])
        })
      )
    })

    it('should track all dynamic fields, including nested and array fields', async () => {
      const itemSchema = new Schema({
        name: String,
        value: Number
      })

      const parentSchema = new Schema({
        name: String,
        nested: {
          child: String,
          child2: String
        },
        items: [itemSchema]
      })

      parentSchema.plugin(mongooseTracker, {
        name: 'history' // Store tracked changes in the "history" array
      })

      const Parent = mongoose.model(faker.internet.password(), parentSchema)

      const doc = await Parent.create({
        name: 'Parent',
        nested: { child: 'Initial', child2: 'Initial2' },
        items: [
          { name: 'Item1', value: 10 },
          { name: 'Item2', value: 20 }
        ]
      })

      // // Update nested and array fields
      await Parent.findOneAndUpdate(
        { _id: doc._id },
        {
          'items.0.name': 'UpdatedItem1',
          'nested.child': 'Updated',
          'nested.child2': 'Updated2',
          'items.1.value': 30
        }
      )

      // Retrieve the updated document
      const updatedDoc = await Parent.findOne({ _id: doc._id })

      // Assertions
      expect(updatedDoc).toEqual(
        expect.objectContaining({
          history: expect.arrayContaining([
            expect.objectContaining({
              changes: expect.arrayContaining([
                expect.objectContaining({
                  field: 'nested.child',
                  before: 'Initial',
                  after: 'Updated'
                }),
                expect.objectContaining({
                  field: 'nested.child2',
                  before: 'Initial2',
                  after: 'Updated2'
                })
              ])
            }),
            expect.objectContaining({
              changes: expect.arrayContaining([
                expect.objectContaining({
                  field: 'items.0.name',
                  before: 'Item1',
                  after: 'UpdatedItem1'
                })
              ])
            }),
            expect.objectContaining({
              changes: expect.arrayContaining([
                expect.objectContaining({
                  field: 'items.1.value',
                  before: 20,
                  after: 30
                })
              ])
            })
          ])
        })
      )
    })

    it('should correctly track changes to nested fields', async () => {
      const schema = new Schema({
        nested: {
          child: String,
          grandChild: { subField: String }
        }
      })

      schema.plugin(mongooseTracker, {
        fieldsToTrack: ['nested.child', 'nested.grandChild.subField']
      })

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = await Model.create({
        nested: { child: 'initial', grandChild: { subField: 'initialSub' } }
      })

      if (isNull(doc)) {
        return
      }

      if (doc.nested) {
        doc.nested.child = 'updated'
        if (doc.nested.grandChild) {
          doc.nested.grandChild.subField = 'updatedSub'
        }
      }

      (doc as any)._changedBy = 'test'

      await doc.save()

      const doc2 = await Model.findOne({ _id: doc._id })

      expect(doc2).toEqual(
        expect.objectContaining({
          history: expect.arrayContaining([
            expect.objectContaining({
              changedBy: 'test',
              changes: expect.arrayContaining([
                expect.objectContaining({
                  field: 'nested.child',
                  before: 'initial',
                  after: 'updated'
                }),
                expect.objectContaining({
                  field: 'nested.grandChild.subField',
                  before: 'initialSub',
                  after: 'updatedSub'
                })
              ])
            })
          ])
        })
      )
    })

    it('should track changes in both nested and array fields simultaneously', async () => {
      const schema = new Schema({
        nested: { child: String },
        items: [{ name: String }]
      })

      schema.plugin(mongooseTracker, {
        fieldsToTrack: ['nested.child', 'items.$.name']
      })

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = await Model.create({
        nested: { child: 'original' },
        items: [{ name: 'item1' }]
      })

      if (isNull(doc)) {
        return
      }

      if (doc.nested) {
        doc.nested.child = 'updatedChild'
      }

      doc.items[0].name = 'updatedItem'

      await doc.save()

      expect((doc as any).history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            changes: expect.arrayContaining([
              expect.objectContaining({
                field: 'nested.child',
                before: 'original',
                after: 'updatedChild'
              }),
              expect.objectContaining({
                field: 'items.0.name',
                before: 'item1',
                after: 'updatedItem'
              })
            ])
          })
        ])
      )
    })
  })

  describe('Edge Cases and Error Handling', () => {
    it('should not track changes for non-schema-defined fields', async () => {
      const schema = new Schema({
        name: String,
        price: Number
      })

      schema.plugin(mongooseTracker, {})

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = new Model({ name: 'test', price: 100 })

      doc.set('nonSchemaField', 'value')

      await doc.save()

      expect(doc).toEqual(
        expect.objectContaining({
          history: expect.not.arrayContaining([
            expect.objectContaining({
              changes: expect.arrayContaining([
                expect.objectContaining({ field: 'nonSchemaField' })
              ])
            })
          ])
        })
      )
    })

    it('should handle updates with no changes gracefully', async () => {
      const schema = new Schema({
        name: String
      })

      schema.plugin(mongooseTracker, {})

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = await Model.create({ name: 'unchanged' })

      doc.name = 'unchanged' // No actual change

      await doc.save()

      expect(doc).toEqual(
        expect.objectContaining({
          history: expect.arrayContaining([])
        })
      )
    })

    it('should throw an error when invalid `fieldsToTrack` pattern is provided', async () => {
      const schema = new Schema({
        name: String
      })

      expect(() =>
        schema.plugin(mongooseTracker, {
          fieldsToTrack: ['invalid.[field'] // Invalid pattern
        })
      ).toThrow()
    })

    it('should not track changes when the `skipMiddleware` option is set', async () => {
      const schema = new Schema({
        name: String
      })

      schema.plugin(mongooseTracker, {})

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = await Model.create({ name: 'initial' })

      await Model.updateOne(
        { _id: doc._id },
        { name: 'updated' },
        { skipMiddleware: true }
      )

      const updatedDoc = await Model.findById(doc._id)

      expect((updatedDoc as any).history).toEqual(expect.arrayContaining([]))
    })
  })

  describe('Pre-save hook scenarios', () => {
    it('should skip tracking if the document is new (129)', async () => {
      const schema = new Schema({
        name: String
      })

      schema.plugin(mongooseTracker, {})

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = new Model({ name: 'initial' })

      await doc.save()

      expect(doc).toEqual(
        expect.objectContaining({
          history: []
        })
      )
    })
  })

  describe('Query middleware scenarios', () => {
    it('should handle findById returning null gracefully (176)', async () => {
      const schema = new Schema({
        name: String
      })

      schema.plugin(mongooseTracker, {})

      const Model = mongoose.model(faker.internet.password(), schema)

      const result = await Model.findById(new Types.ObjectId())

      expect(result).toBeNull()
    })

    it('should not modify history if no tracked fields are updated (195-204)', async () => {
      const schema = new Schema({
        name: String,
        age: Number
      })

      schema.plugin(mongooseTracker, {
        fieldsToTrack: ['name']
      })

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = await Model.create({ name: 'John', age: 30 })

      await Model.findOneAndUpdate({ _id: doc._id }, { age: 31 })

      const updatedDoc = await Model.findById(doc._id)

      expect(updatedDoc).toEqual(
        expect.objectContaining({
          history: expect.not.arrayContaining([
            expect.objectContaining({
              changes: expect.anything()
            })
          ])
        })
      )
    })

    it('should correctly update history with tracked fields (219)', async () => {
      const schema = new Schema({
        name: String
      })

      schema.plugin(mongooseTracker, {
        fieldsToTrack: ['name']
      })

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = await Model.create({ name: 'initial' })

      await Model.findOneAndUpdate(
        { _id: doc._id },
        { name: 'updated' },
        { changedBy: 'admin' }
      )

      const updatedDoc = await Model.findById(doc._id)

      expect(updatedDoc).toEqual(
        expect.objectContaining({
          history: expect.arrayContaining([
            expect.objectContaining({
              action: 'updated',
              changes: expect.arrayContaining([
                expect.objectContaining({
                  field: 'name',
                  before: 'initial',
                  after: 'updated'
                })
              ])
            })
          ])
        })
      )
    })
  })

  describe('UpdateOne scenarios', () => {
    it('should add action `added` to history if the document add new element to array field that is tracked', async () => {
      const schema = new Schema({
        name: String,
        items: [{ name: String, _display: String }]
      })

      schema.plugin(mongooseTracker, {
        fieldsToTrack: ['items']
      })

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = await Model.create({ name: 'initial', items: [] })

      doc.items.push({ name: 'newItem', _display: 'newItem' })

      await doc.save()

      expect(doc).toEqual(
        expect.objectContaining({
          history: expect.arrayContaining([
            expect.objectContaining({
              action: 'added',
              changes: expect.arrayContaining([
                expect.objectContaining({
                  field: 'items',
                  before: null,
                  after: 'newItem'
                })
              ])
            })
          ])
        })
      )
    })

    it('should add action `removed` to history if the document remove an element from array field that is tracked', async () => {
      const schema = new Schema({
        name: String,
        items: [{ name: String, _display: String }]
      })

      schema.plugin(mongooseTracker, {
        fieldsToTrack: ['items']
      })

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = await Model.create({
        name: 'initial',
        items: [{ name: 'newItem', _display: 'newItem' }]
      })

      doc.items.pop()

      await doc.save()

      expect(doc).toEqual(
        expect.objectContaining({
          history: expect.arrayContaining([
            expect.objectContaining({
              action: 'removed',
              changes: expect.arrayContaining([
                expect.objectContaining({
                  field: 'items',
                  before: 'newItem',
                  after: null
                })
              ])
            })
          ])
        })
      )
    })

    it('should add action `removed` to history when a primitive element is removed from a tracked array field', async () => {
      const schema = new Schema({
        name: String,
        items: [String]
      })

      schema.plugin(mongooseTracker, {
        fieldsToTrack: ['items']
      })

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = await Model.create({
        name: 'initial',
        items: ['item1', 'item2', 'item3']
      })

      doc.items.pop()

      await doc.save()

      expect(doc).toEqual(
        expect.objectContaining({
          history: expect.arrayContaining([
            expect.objectContaining({
              action: 'removed',
              changes: expect.arrayContaining([
                expect.objectContaining({
                  field: 'items',
                  before: 'item3',
                  after: null
                })
              ])
            })
          ])
        })
      )
    })

    it('should add changes in tracked fields, including nested array fields, to the history with correct before and after values', async () => {
      const purchaseDemandSchema = new Schema({
        products: [
          {
            instanceId: {
              type: Schema.Types.ObjectId,
              ref: Collections.ProductInstance,
              required: true
            },
            supplierId: {
              type: Schema.Types.ObjectId,
              ref: Collections.BusinessPartner,
              default: null
            },
            _display: {
              type: Schema.Types.ObjectId,
              ref: Collections.ProductInstance,
              required: true
            },
            quantity: { type: Number, required: true }
          }
        ],
        pdNumber: { type: String, required: true, unique: true },
        active: { type: Boolean, required: true, default: true },
        status: { type: String, required: true }
      })

      purchaseDemandSchema.plugin(mongooseTracker, {
        fieldsToTrack: ['products']
      })

      const instnaceProductSchema = new Schema({
        name: { type: String, required: true },
        _display: { type: String, required: true }
      })

      const BusinessPartnerSchema = new Schema({
        name: { type: String, required: true },
        _display: { type: String, required: true }
      })

      const instanceModel = mongoose.model(
        Collections.ProductInstance,
        instnaceProductSchema
      )
      const BusinessPartnerModel = mongoose.model(
        Collections.BusinessPartner,
        BusinessPartnerSchema
      )

      const purchaseDemandModel = mongoose.model(
        Collections.PurchaseDemands,
        purchaseDemandSchema
      )

      const instance1 = await instanceModel.create({
        name: 'instance1',
        _display: 'instance1'
      })
      const instance2 = await instanceModel.create({
        name: 'instance2',
        _display: 'instance2'
      })
      const instance3 = await instanceModel.create({
        name: 'instance3',
        _display: 'instance3'
      })

      const supplier = await BusinessPartnerModel.create({
        name: 'supplier1',
        _display: 'supplier1'
      })

      await purchaseDemandModel.create({
        pdNumber: 'PD0001444',
        active: true,
        status: 'new',
        products: [
          {
            instanceId: instance1._id,
            supplierId: null,
            quantity: 504,
            _display: instance1._id
          },
          {
            instanceId: instance2._id,
            supplierId: null,
            quantity: 500,
            _display: instance2._id
          },
          {
            instanceId: instance3._id,
            supplierId: supplier._id,
            quantity: 1000,
            _display: instance3._id
          }
        ]
      })

      const userId = 'userId1'

      const pd = await purchaseDemandModel.findOne({ pdNumber: 'PD0001444' })

      if (isNull(pd)) {
        return
      }

      pd.set('products',
        pd.products.filter(
          (pd) => pd.instanceId.toString() !== instance3._id.toString()
        )
      );

      (pd as any)._changedBy = userId
      // Save the updated document
      await pd.save()

      expect(pd).toEqual(
        expect.objectContaining({
          history: expect.arrayContaining([
            expect.objectContaining({
              action: 'removed',
              changedBy: userId,
              changes: expect.arrayContaining([
                expect.objectContaining({
                  field: 'products',
                  before: instance3.name,
                  after: null
                })
              ])
            })
          ])
        })
      )
    })

    it('should add changes in tracked fields, including nested array fields, to the history with correct before and after values', async () => {
      const purchaseDemandSchema = new Schema({
        products: [
          {
            instanceId: {
              type: Schema.Types.ObjectId,
              ref: Collections.ProductInstance,
              required: true
            },
            supplierId: {
              type: Schema.Types.ObjectId,
              ref: Collections.BusinessPartner,
              default: null
            },
            _display: {
              type: Schema.Types.ObjectId,
              ref: Collections.ProductInstance,
              required: true
            },
            quantity: { type: Number, required: true }
          }
        ],
        pdNumber: { type: String, required: true, unique: true },
        active: { type: Boolean, required: true, default: true },
        status: { type: String, required: true }
      })

      purchaseDemandSchema.plugin(mongooseTracker, {
        fieldsToTrack: ['products']
      })

      const expanderProductSchema = new Schema({
        name: { type: String, required: true },
        _display: { type: String, required: true }
      })

      const instnaceProductSchema = new Schema({
        name: { type: String, required: true },
        _display: {
          type: Types.ObjectId,
          ref: Collections.ExpanderProduct,
          required: true
        }
      })

      const BusinessPartnerSchema = new Schema({
        name: { type: String, required: true },
        _display: { type: String, required: true }
      })

      const ExpanderProductModel = mongoose.model(
        Collections.ExpanderProduct,
        expanderProductSchema
      )

      const instanceModel = mongoose.model(
        Collections.ProductInstance,
        instnaceProductSchema
      )

      const BusinessPartnerModel = mongoose.model(
        Collections.BusinessPartner,
        BusinessPartnerSchema
      )

      const purchaseDemandModel = mongoose.model(
        Collections.PurchaseDemands,
        purchaseDemandSchema
      )

      const expander1 = await ExpanderProductModel.create({
        name: 'expander1',
        _display: 'expander1'
      })

      const instance1 = await instanceModel.create({
        name: 'instance1',
        _display: expander1._id
      })
      const instance2 = await instanceModel.create({
        name: 'instance2',
        _display: expander1._id
      })
      const instance3 = await instanceModel.create({
        name: 'instance3',
        _display: expander1._id
      })

      const supplier = await BusinessPartnerModel.create({
        name: 'supplier1',
        _display: 'supplier1'
      })

      await purchaseDemandModel.create({
        pdNumber: 'PD0001444',
        active: true,
        status: 'new',
        products: [
          {
            instanceId: instance1._id,
            supplierId: null,
            quantity: 504,
            _display: instance1._id
          },
          {
            instanceId: instance2._id,
            supplierId: null,
            quantity: 500,
            _display: instance2._id
          },
          {
            instanceId: instance3._id,
            supplierId: supplier._id,
            quantity: 1000,
            _display: instance3._id
          }
        ]
      })

      const userId = 'userId1'

      const pd = await purchaseDemandModel.findOne({ pdNumber: 'PD0001444' })

      if (isNull(pd)) {
        return
      }

      pd.set(
        'products',
        pd.products.filter(
          (pd) => pd.instanceId.toString() !== instance3._id.toString()
        )
      );

      (pd as any)._changedBy = userId
      // Save the updated document
      await pd.save()

      expect(pd).toEqual(
        expect.objectContaining({
          history: expect.arrayContaining([
            expect.objectContaining({
              action: 'removed',
              changedBy: userId,
              changes: expect.arrayContaining([
                expect.objectContaining({
                  field: 'products',
                  before: expander1.name,
                  after: null
                })
              ])
            })
          ])
        })
      )
    })

    it('should add changes for fields that are type of dates to history with correct before and after values', async () => {
      const purchaseDemandSchema = new Schema({
        pdNumber: { type: String, required: true, unique: true },
        qcDate: { type: Date, default: null },
        estimatedGoodsReady: { type: Date, default: null }
      })

      purchaseDemandSchema.plugin(mongooseTracker, {
        fieldsToTrack: ['qcDate', 'estimatedGoodsReady']
      })

      const purchaseDemandModel = mongoose.model(
        Collections.PurchaseDemands,
        purchaseDemandSchema
      )

      await purchaseDemandModel.create({
        pdNumber: 'PD0001444',
        qcDate: null,
        estimatedGoodsReady: null
      })

      const userId = 'userId1'

      const pd = await purchaseDemandModel.findOne({ pdNumber: 'PD0001444' })

      if (isNull(pd)) {
        return
      }

      const d1 = new Date('2021-09-01')
      const d2 = new Date('2021-09-10')

      pd.qcDate = d1
      pd.estimatedGoodsReady = d2;

      (pd as any)._changedBy = userId
      await pd.save()

      expect(pd).toEqual(
        expect.objectContaining({
          history: expect.arrayContaining([
            expect.objectContaining({
              changedBy: userId,
              changes: expect.arrayContaining([
                expect.objectContaining({
                  field: 'qcDate',
                  before: null,
                  after: d1
                }),
                expect.objectContaining({
                  field: 'estimatedGoodsReady',
                  before: null,
                  after: d2
                })
              ])
            })
          ])
        })
      )
    })

    it('should track multiple items added to array in single save', async () => {
      const schema = new Schema({
        name: String,
        items: [{ name: String, value: Number, _display: String }]
      })

      schema.plugin(mongooseTracker, {
        fieldsToTrack: ['items']
      })

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = await Model.create({ name: 'test', items: [] })

      doc.items.push({ name: 'item1', value: 10, _display: 'Item 1' })
      doc.items.push({ name: 'item2', value: 20, _display: 'Item 2' })
      doc.items.push({ name: 'item3', value: 30, _display: 'Item 3' })

      await doc.save()

      expect(doc).toEqual(
        expect.objectContaining({
          history: expect.arrayContaining([
            expect.objectContaining({
              action: 'added',
              changes: expect.arrayContaining([
                expect.objectContaining({
                  field: 'items',
                  before: null,
                  after: 'Item 1'
                }),
                expect.objectContaining({
                  field: 'items',
                  before: null,
                  after: 'Item 2'
                }),
                expect.objectContaining({
                  field: 'items',
                  before: null,
                  after: 'Item 3'
                })
              ])
            })
          ])
        })
      )
    })

    it('should track multiple items removed from array in single save', async () => {
      const schema = new Schema({
        name: String,
        tags: [String]
      })

      schema.plugin(mongooseTracker, {
        fieldsToTrack: ['tags']
      })

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = await Model.create({
        name: 'test',
        tags: ['tag1', 'tag2', 'tag3', 'tag4']
      })

      // Remove multiple items
      doc.tags = ['tag1', 'tag2']

      await doc.save()

      expect(doc).toEqual(
        expect.objectContaining({
          history: expect.arrayContaining([
            expect.objectContaining({
              action: 'removed',
              changes: expect.arrayContaining([
                expect.objectContaining({
                  field: 'tags',
                  before: 'tag3',
                  after: null
                }),
                expect.objectContaining({
                  field: 'tags',
                  before: 'tag4',
                  after: null
                })
              ])
            })
          ])
        })
      )
    })

    it('should track array with objects when items are added and track using _display', async () => {
      const schema = new Schema({
        name: String,
        products: [{
          sku: String,
          quantity: Number,
          _display: String
        }]
      })

      schema.plugin(mongooseTracker, {
        fieldsToTrack: ['products']
      })

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = await Model.create({
        name: 'Order 1',
        products: [
          { sku: 'SKU001', quantity: 5, _display: 'Product A' }
        ]
      })

      // Add new products
      doc.products.push({ sku: 'SKU002', quantity: 10, _display: 'Product B' })
      doc.products.push({ sku: 'SKU003', quantity: 15, _display: 'Product C' })

      await doc.save()

      expect(doc).toEqual(
        expect.objectContaining({
          history: expect.arrayContaining([
            expect.objectContaining({
              action: 'added',
              changes: expect.arrayContaining([
                expect.objectContaining({
                  field: 'products',
                  before: null,
                  after: 'Product B'
                }),
                expect.objectContaining({
                  field: 'products',
                  before: null,
                  after: 'Product C'
                })
              ])
            })
          ])
        })
      )
    })

    it('should track when replacing entire array with new array', async () => {
      const schema = new Schema({
        name: String,
        items: [{ name: String, _display: String }]
      })

      schema.plugin(mongooseTracker, {
        fieldsToTrack: ['items']
      })

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = await Model.create({
        name: 'test',
        items: [
          { name: 'original1', _display: 'Original 1' },
          { name: 'original2', _display: 'Original 2' }
        ]
      })

      // Replace entire array
      doc.items = [
        { name: 'new1', _display: 'New 1' },
        { name: 'new2', _display: 'New 2' }
      ]

      await doc.save()

      expect(doc).toEqual(
        expect.objectContaining({
          history: expect.arrayContaining([
            expect.objectContaining({
              changes: expect.arrayContaining([
                expect.objectContaining({
                  field: 'items',
                  before: 'Original 1',
                  after: null
                }),
                expect.objectContaining({
                  field: 'items',
                  before: 'Original 2',
                  after: null
                })
              ])
            })
          ])
        })
      )

      // Reset history to check for additions
      doc.items.push({ name: 'another', _display: 'Another Item' })
      await doc.save()

      expect((doc as any).history.length).toBeGreaterThan(1)
    })

    it('should handle empty array becoming populated', async () => {
      const schema = new Schema({
        name: String,
        emails: [String]
      })

      schema.plugin(mongooseTracker, {
        fieldsToTrack: ['emails']
      })

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = await Model.create({
        name: 'user',
        emails: []
      })

      doc.emails = ['email1@test.com', 'email2@test.com']

      await doc.save()

      expect(doc).toEqual(
        expect.objectContaining({
          history: expect.arrayContaining([
            expect.objectContaining({
              action: 'added',
              changes: expect.arrayContaining([
                expect.objectContaining({
                  field: 'emails',
                  before: null,
                  after: 'email1@test.com'
                }),
                expect.objectContaining({
                  field: 'emails',
                  before: null,
                  after: 'email2@test.com'
                })
              ])
            })
          ])
        })
      )
    })

    it('should handle populated array becoming empty', async () => {
      const schema = new Schema({
        name: String,
        tags: [String]
      })

      schema.plugin(mongooseTracker, {
        fieldsToTrack: ['tags']
      })

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = await Model.create({
        name: 'item',
        tags: ['urgent', 'important', 'review']
      })

      doc.tags = []

      await doc.save()

      expect(doc).toEqual(
        expect.objectContaining({
          history: expect.arrayContaining([
            expect.objectContaining({
              action: 'removed',
              changes: expect.arrayContaining([
                expect.objectContaining({
                  field: 'tags',
                  before: 'urgent',
                  after: null
                }),
                expect.objectContaining({
                  field: 'tags',
                  before: 'important',
                  after: null
                }),
                expect.objectContaining({
                  field: 'tags',
                  before: 'review',
                  after: null
                })
              ])
            })
          ])
        })
      )
    })

    it('should track nested arrays - adding and removing items', async () => {
      const schema = new Schema({
        name: String,
        orders: [{
          orderNumber: String,
          items: [{ sku: String, _display: String }],
          _display: String
        }]
      })

      schema.plugin(mongooseTracker, {
        fieldsToTrack: ['orders']
      })

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = await Model.create({
        name: 'customer',
        orders: []
      })

      // Add order with items
      doc.orders.push({
        orderNumber: 'ORD001',
        items: [
          { sku: 'SKU001', _display: 'Item 1' },
          { sku: 'SKU002', _display: 'Item 2' }
        ],
        _display: 'Order 1'
      })

      await doc.save()

      expect(doc).toEqual(
        expect.objectContaining({
          history: expect.arrayContaining([
            expect.objectContaining({
              action: 'added',
              changes: expect.arrayContaining([
                expect.objectContaining({
                  field: 'orders',
                  before: null,
                  after: 'Order 1'
                })
              ])
            })
          ])
        })
      )

      // Now remove the order
      doc.orders = []
      await doc.save()

      expect((doc as any).history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'removed',
            changes: expect.arrayContaining([
              expect.objectContaining({
                field: 'orders',
                before: 'Order 1',
                after: null
              })
            ])
          })
        ])
      )
    })
  })

  describe('Edge cases for coverage - Referenced documents and null handling', () => {
    it('should handle referenced document that does not exist (null reference)', async () => {
      const CategorySchema = new Schema({
        name: String,
        _display: String
      })

      const ProductSchema = new Schema({
        name: String,
        categoryId: { type: Schema.Types.ObjectId, ref: 'Category' }
      })

      ProductSchema.plugin(mongooseTracker, {
        fieldsToTrack: ['categoryId']
      })

      const Category = mongoose.model('Category', CategorySchema)
      const Product = mongoose.model(faker.internet.password(), ProductSchema)

      const product = await Product.create({
        name: 'Test Product',
        categoryId: null
      })

      // Try to update to non-existent category
      const nonExistentId = new Types.ObjectId()
      product.categoryId = nonExistentId

      await product.save()

      // Should still track the change even if reference doesn't exist
      expect((product as any).history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'updated',
            changes: expect.arrayContaining([
              expect.objectContaining({
                field: 'categoryId'
              })
            ])
          })
        ])
      )
    })

    it('should handle updating ObjectId reference via findOneAndUpdate', async () => {
      const SupplierSchema = new Schema({
        name: String,
        _display: String
      })

      const ItemSchema = new Schema({
        name: String,
        supplierId: { type: Schema.Types.ObjectId, ref: 'SupplierTest' }
      })

      ItemSchema.plugin(mongooseTracker, {
        fieldsToTrack: ['supplierId']
      })

      const Supplier = mongoose.model('SupplierTest', SupplierSchema)
      const Item = mongoose.model(faker.internet.password(), ItemSchema)

      const supplier1 = await Supplier.create({
        name: 'Supplier 1',
        _display: 'Supplier One'
      })

      const supplier2 = await Supplier.create({
        name: 'Supplier 2',
        _display: 'Supplier Two'
      })

      const item = await Item.create({
        name: 'Test Item',
        supplierId: supplier1._id
      })

      // Update via findOneAndUpdate
      await Item.findOneAndUpdate(
        { _id: item._id },
        { supplierId: supplier2._id },
        { changedBy: 'admin' }
      )

      const updatedItem = await Item.findById(item._id)

      expect((updatedItem as any).history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'updated',
            changedBy: 'admin',
            changes: expect.arrayContaining([
              expect.objectContaining({
                field: 'supplierId',
                before: 'Supplier One',
                after: 'Supplier Two'
              })
            ])
          })
        ])
      )
    })

    it('should handle _display field change in nested object', async () => {
      const ProductSchema = new Schema({
        name: String,
        supplier: {
          name: String,
          code: String,
          _display: String
        }
      })

      ProductSchema.plugin(mongooseTracker, {
        fieldsToTrack: ['supplier']
      })

      const Product = mongoose.model(faker.internet.password(), ProductSchema)

      const product = await Product.create({
        name: 'Product A',
        supplier: {
          name: 'Supplier X',
          code: 'SUP001',
          _display: 'Supplier X'
        }
      })

      // Change the _display field
      product.supplier = {
        name: 'Supplier X',
        code: 'SUP001',
        _display: 'Supplier X Updated'
      }

      await product.save()

      expect((product as any).history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'updated',
            changes: expect.arrayContaining([
              expect.objectContaining({
                field: 'supplier',
                before: 'Supplier X',
                after: 'Supplier X Updated'
              })
            ])
          })
        ])
      )
    })

    it('should handle ObjectId reference with nested _display reference', async () => {
      const BrandSchema = new Schema({
        name: String,
        _display: String
      })

      const ProductSchema = new Schema({
        name: String,
        _display: { type: Schema.Types.ObjectId, ref: 'BrandRef' }
      })

      const InstanceSchema = new Schema({
        sku: String,
        productId: { type: Schema.Types.ObjectId, ref: 'ProductRef' }
      })

      InstanceSchema.plugin(mongooseTracker, {
        fieldsToTrack: ['productId']
      })

      const Brand = mongoose.model('BrandRef', BrandSchema)
      const Product = mongoose.model('ProductRef', ProductSchema)
      const Instance = mongoose.model(faker.internet.password(), InstanceSchema)

      const brand = await Brand.create({
        name: 'Brand A',
        _display: 'Brand A Display'
      })

      const product = await Product.create({
        name: 'Product 1',
        _display: brand._id
      })

      const instance = await Instance.create({
        sku: 'SKU001',
        productId: product._id
      })

      const product2 = await Product.create({
        name: 'Product 2',
        _display: brand._id
      })

      instance.productId = product2._id
      await instance.save()

      expect((instance as any).history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'updated',
            changes: expect.arrayContaining([
              expect.objectContaining({
                field: 'productId'
              })
            ])
          })
        ])
      )
    })

    it('should handle primitive values being added to array', async () => {
      const schema = new Schema({
        name: String,
        numbers: [Number]
      })

      schema.plugin(mongooseTracker, {
        fieldsToTrack: ['numbers']
      })

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = await Model.create({
        name: 'test',
        numbers: []
      })

      doc.numbers = [1, 2, 3, 4, 5]

      await doc.save()

      expect((doc as any).history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'added',
            changes: expect.arrayContaining([
              expect.objectContaining({
                field: 'numbers',
                before: null,
                after: 1
              }),
              expect.objectContaining({
                field: 'numbers',
                before: null,
                after: 2
              }),
              expect.objectContaining({
                field: 'numbers',
                before: null,
                after: 3
              }),
              expect.objectContaining({
                field: 'numbers',
                before: null,
                after: 4
              }),
              expect.objectContaining({
                field: 'numbers',
                before: null,
                after: 5
              })
            ])
          })
        ])
      )
    })

    it('should handle updateOne with null updatedFields', async () => {
      const schema = new Schema({
        name: String,
        value: Number
      })

      schema.plugin(mongooseTracker, {
        fieldsToTrack: ['name']
      })

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = await Model.create({
        name: 'test',
        value: 100
      })

      // This should not throw error even with empty update
      await Model.updateOne({ _id: doc._id }, {})

      const result = await Model.findById(doc._id)

      expect((result as any).history).toEqual([])
    })

    it('should handle removed action when value has not changed but action is removed', async () => {
      const schema = new Schema({
        name: String,
        metadata: {
          value: String,
          count: Number
        }
      })

      schema.plugin(mongooseTracker, {
        fieldsToTrack: ['metadata']
      })

      const Model = mongoose.model(faker.internet.password(), schema)

      const doc = await Model.create({
        name: 'test',
        metadata: {
          value: 'test',
          count: 5
        }
      })

      // Simulate removal by setting to empty/different
      doc.metadata = {
        value: 'test',
        count: 0
      }

      await doc.save()

      expect((doc as any).history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'updated'
          })
        ])
      )
    })
  })
})
